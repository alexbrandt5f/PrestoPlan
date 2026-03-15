import { useRef, useEffect, useState, useMemo } from 'react';
import { useGanttLayout } from '../../contexts/GanttLayoutContext';
import { supabase } from '../../lib/supabase';
import { hoursToWorkingDays, getEffectiveDates, isMilestone } from '../../lib/dateUtils';

interface Activity {
  id: string;
  activity_id_display: string;
  activity_name: string;
  activity_type: string;
  early_start: string | null;
  early_finish: string | null;
  calendar_id: string | null;
  is_critical: boolean | null;
  original_duration_hours: number | null;
  remaining_duration_hours: number | null;
  total_float_hours: number | null;
  [key: string]: any;
}

interface Calendar {
  id: string;
  hours_per_day: number;
}

interface Relationship {
  predecessor_activity_id: string;
  successor_activity_id: string;
  relationship_type: string;
  is_driving: boolean | null;
  relationship_float_hours: number | null;
}

interface GanttChartAdvancedProps {
  activities: Activity[];
  calendars: Calendar[];
  selectedActivity: Activity | null;
  dataDate: string | null;
  scheduleVersionId: string;
  groupedActivities: Array<{ type: 'group' | 'activity'; groupKey?: string; groupLabel?: string; activities?: Activity[]; activity?: Activity }>;
  nearCriticalThreshold: number;
  codeColors: Map<string, string>;
  onActivitySelect?: (activity: Activity) => void;
}

const ROW_HEIGHT = 26;
const HEADER_HEIGHT = 40;
const BAR_HEIGHT = 12;

const TIMESCALE_CONFIGS = {
  'year-month': { primaryDays: 365, secondaryDays: 30, pixelsPerDay: 0.5 },
  'year-month-week': { primaryDays: 30, secondaryDays: 7, pixelsPerDay: 2 },
  'month-week-day': { primaryDays: 7, secondaryDays: 1, pixelsPerDay: 20 },
  'quarter-month': { primaryDays: 90, secondaryDays: 30, pixelsPerDay: 1 }
};

export default function GanttChartAdvanced({
  activities,
  calendars,
  selectedActivity,
  dataDate,
  scheduleVersionId,
  groupedActivities,
  nearCriticalThreshold,
  codeColors,
  onActivitySelect
}: GanttChartAdvancedProps) {
  const { layout, updateViewSettings } = useGanttLayout();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, scrollLeft: 0 });
  const [zoomStart, setZoomStart] = useState({ x: 0, initialZoom: 1 });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [hasMoved, setHasMoved] = useState(false);

  const timescaleConfig = TIMESCALE_CONFIGS[layout.viewSettings.timescale] || TIMESCALE_CONFIGS['year-month'];
  const pixelsPerDay = timescaleConfig.pixelsPerDay * layout.viewSettings.zoom;

  const calendarMap = useMemo(() => {
    const map = new Map<string, Calendar>();
    calendars.forEach(cal => map.set(cal.id, cal));
    return map;
  }, [calendars]);

  useEffect(() => {
    if (layout.viewSettings.showRelationships !== 'none') {
      loadRelationships();
    } else {
      setRelationships([]);
    }
  }, [layout.viewSettings.showRelationships, scheduleVersionId]);

  useEffect(() => {
    function handleCollapsedGroupsChange(e: Event) {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.collapsedGroups) {
        setCollapsedGroups(customEvent.detail.collapsedGroups);
      }
    }

    window.addEventListener('collapsed-groups-change', handleCollapsedGroupsChange);
    return () => window.removeEventListener('collapsed-groups-change', handleCollapsedGroupsChange);
  }, []);

  useEffect(() => {
    if (!selectedActivity || !scrollContainerRef.current) return;

    const rowIndex = visibleGroupedActivities.findIndex(item =>
      item.type === 'activity' && item.activity?.id === selectedActivity.id
    );

    if (rowIndex !== -1) {
      const scrollTop = rowIndex * ROW_HEIGHT + HEADER_HEIGHT;
      const containerHeight = scrollContainerRef.current.clientHeight;
      const currentScrollTop = scrollContainerRef.current.scrollTop;

      if (scrollTop < currentScrollTop || scrollTop > currentScrollTop + containerHeight - ROW_HEIGHT) {
        scrollContainerRef.current.scrollTop = scrollTop - containerHeight / 2 + ROW_HEIGHT / 2;
      }
    }
  }, [selectedActivity, visibleGroupedActivities]);

  const visibleGroupedActivities: Array<{ type: 'group' | 'activity'; groupKey?: string; groupLabel?: string; activities?: Activity[]; activity?: Activity; level?: number }> = useMemo(() => {
    const result: Array<{ type: 'group' | 'activity'; groupKey?: string; groupLabel?: string; activities?: Activity[]; activity?: Activity; level?: number }> = [];
    const collapsedStack: Array<{ key: string; level: number }> = [];

    for (const item of groupedActivities) {
      if (item.type === 'group') {
        while (collapsedStack.length > 0 && collapsedStack[collapsedStack.length - 1].level >= (item.level || 0)) {
          collapsedStack.pop();
        }

        if (collapsedStack.length === 0) {
          result.push(item);
        }

        if (collapsedGroups.has(item.groupKey!)) {
          collapsedStack.push({ key: item.groupKey!, level: item.level || 0 });
        }
      } else if (item.type === 'activity') {
        if (collapsedStack.length === 0) {
          result.push(item);
        }
      }
    }

    return result;
  }, [groupedActivities, collapsedGroups]);

  useEffect(() => {
    if (!selectedActivity || !scrollContainerRef.current) return;

    const selectedIndex = visibleGroupedActivities.findIndex(
      item => item.type === 'activity' && item.activity?.id === selectedActivity.id
    );

    if (selectedIndex === -1) return;

    const { start: startDate, finish: finishDate } = getEffectiveDates(selectedActivity);
    if (!startDate || !finishDate) return;

    const x1 = dateToX(startDate);
    const x2 = dateToX(finishDate);

    const container = scrollContainerRef.current;
    const visibleLeft = container.scrollLeft;
    const visibleRight = visibleLeft + container.clientWidth;

    if (x1 >= visibleLeft && x2 <= visibleRight) {
      return;
    }

    const targetScrollLeft = Math.max(0, x1 - container.clientWidth / 4);
    const startScrollLeft = container.scrollLeft;
    const distance = targetScrollLeft - startScrollLeft;
    const duration = 500;
    const startTime = performance.now();

    function easeInOutCubic(t: number): number {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function animate(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeInOutCubic(progress);

      container.scrollLeft = startScrollLeft + distance * eased;

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
  }, [selectedActivity, visibleGroupedActivities]);

  async function loadRelationships() {
    const { data } = await supabase
      .from('cpm_relationships')
      .select('predecessor_activity_id, successor_activity_id, relationship_type, is_driving, relationship_float_hours')
      .eq('schedule_version_id', scheduleVersionId);

    if (data) {
      setRelationships(data);
    }
  }

  const activityMap = useMemo(() => {
    const map = new Map<string, Activity>();
    activities.forEach(act => map.set(act.id, act));
    return map;
  }, [activities]);

  const { minDate, maxDate, timelineWidth } = useMemo(() => {
    if (activities.length === 0) {
      const now = new Date();
      return { minDate: now, maxDate: now, timelineWidth: 1000 };
    }

    let minTimestamp = Infinity;
    let maxTimestamp = -Infinity;

    activities.forEach(activity => {
      const dates = [
        activity.early_start,
        activity.early_finish,
        activity.actual_start,
        activity.actual_finish
      ].filter(Boolean).map(d => new Date(d as string).getTime());

      dates.forEach(timestamp => {
        if (timestamp < minTimestamp) minTimestamp = timestamp;
        if (timestamp > maxTimestamp) maxTimestamp = timestamp;
      });
    });

    if (!isFinite(minTimestamp) || !isFinite(maxTimestamp)) {
      const now = new Date();
      return { minDate: now, maxDate: now, timelineWidth: 1000 };
    }

    const min = new Date(minTimestamp);
    const max = new Date(maxTimestamp);

    min.setDate(min.getDate() - 30);
    max.setDate(max.getDate() + 30);

    const days = Math.ceil((max.getTime() - min.getTime()) / (1000 * 60 * 60 * 24));
    const width = Math.max(days * pixelsPerDay, 2000);

    return { minDate: min, maxDate: max, timelineWidth: width };
  }, [activities, pixelsPerDay]);

  // ResizeObserver detects:
  //   1. Initial paint (when container goes from 0x0 to actual size)
  //   2. Browser window resize
  //   3. Splitter drag (ResizablePanels changes container width/height)
  // This replaces the old window.addEventListener('resize') which missed cases 1 and 3.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setViewportSize({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    function handleScroll() {
      if (scrollContainer) {
        setScrollTop(scrollContainer.scrollTop);
        setScrollLeft(scrollContainer.scrollLeft);

        const event = new CustomEvent('gantt-scroll', {
          detail: { scrollTop: scrollContainer.scrollTop }
        });
        window.dispatchEvent(event);
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    function handleTableScroll(e: Event) {
      const customEvent = e as CustomEvent;
      if (scrollContainerRef.current && customEvent.detail?.scrollTop !== undefined) {
        scrollContainerRef.current.scrollTop = customEvent.detail.scrollTop;
      }
    }

    window.addEventListener('activity-table-scroll', handleTableScroll);
    return () => window.removeEventListener('activity-table-scroll', handleTableScroll);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewportSize.width === 0 || viewportSize.height === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = viewportSize.width * dpr;
    canvas.height = viewportSize.height * dpr;
    canvas.style.width = `${viewportSize.width}px`;
    canvas.style.height = `${viewportSize.height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, viewportSize.width, viewportSize.height);

    drawTimeline(ctx, viewportSize.width, scrollLeft);
    drawHorizontalGridlines(ctx, scrollTop, viewportSize.height);
    if (layout.viewSettings.showRelationships !== 'none') {
      drawRelationships(ctx, scrollTop, scrollLeft);
    }
    drawActivities(ctx, scrollTop, scrollLeft, viewportSize.height);
    drawDataDateLine(ctx, scrollLeft, viewportSize.height);
    drawTodayLine(ctx, scrollLeft, viewportSize.height);
  }, [activities, selectedActivity, scrollTop, scrollLeft, viewportSize, minDate, dataDate, timelineWidth, layout, visibleGroupedActivities, relationships]);

  function dateToX(date: Date): number {
    const dayOffset = (date.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24);
    return dayOffset * pixelsPerDay;
  }

  function xToDate(x: number): Date {
    const days = x / pixelsPerDay;
    return new Date(minDate.getTime() + days * (1000 * 60 * 60 * 24));
  }

  function isMilestone(activity: Activity): boolean {
    return activity.activity_type === 'start_milestone' ||
           activity.activity_type === 'finish_milestone' ||
           activity.original_duration_hours === 0;
  }

  function getBarColors(activity: Activity): { fill: string; outline: string } {
    let fill = '#DCFCE7';
    let outline = '#27AE60';

    if (layout.viewSettings.colorByCodeTypeId && activity[`code_${layout.viewSettings.colorByCodeTypeId}`]) {
      const codeValue = activity[`code_${layout.viewSettings.colorByCodeTypeId}`];
      fill = codeColors.get(codeValue) || fill;
    }

    if (activity.activity_status === 'complete') {
      outline = '#3B82F6';
    } else if (activity.is_critical) {
      outline = '#E74C3C';
    } else if (activity.total_float_hours !== null && activity.calendar_id) {
      const calendar = calendarMap.get(activity.calendar_id);
      const floatDays = activity.total_float_hours / (calendar?.hours_per_day || 8);
      if (floatDays <= nearCriticalThreshold) {
        outline = '#F39C12';
      }
    }

    return { fill, outline };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (isZooming) {
      const deltaX = e.clientX - zoomStart.x;
      if (Math.abs(deltaX) > 3) {
        setHasMoved(true);
      }
      const zoomFactor = 1 + (deltaX / 300);
      const newZoom = Math.max(0.1, Math.min(5, zoomStart.initialZoom * zoomFactor));
      updateViewSettings({ zoom: newZoom });
      return;
    }

    if (isPanning) {
      const deltaX = e.clientX - panStart.x;
      const deltaY = e.clientY - panStart.y;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        setHasMoved(true);
      }
      const scrollContainer = scrollContainerRef.current;
      if (scrollContainer && hasMoved) {
        scrollContainer.scrollLeft = panStart.scrollLeft - deltaX;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft;
    const y = e.clientY - rect.top + scrollTop;

    if (y < HEADER_HEIGHT) {
      setTooltip(null);
      return;
    }

    const rowIndex = Math.floor((y - HEADER_HEIGHT) / ROW_HEIGHT);
    if (rowIndex >= 0 && rowIndex < visibleGroupedActivities.length) {
      const item = visibleGroupedActivities[rowIndex];

      if (item.type === 'activity') {
        const activity = item.activity!;

        const { start: startDate, finish: finishDate } = getEffectiveDates(activity);
        if (startDate && finishDate) {
          const x1 = dateToX(startDate);
          const x2 = dateToX(finishDate);
          const rowY = HEADER_HEIGHT + (rowIndex * ROW_HEIGHT);
          const barY = rowY + (ROW_HEIGHT - BAR_HEIGHT) / 2;

          if (x >= x1 && x <= x2 && y >= barY && y <= barY + BAR_HEIGHT) {
            const calendar = calendarMap.get(activity.calendar_id || '');
            const hoursPerDay = calendar?.hours_per_day || 8;

            const content = [
              activity.activity_id_display,
              activity.activity_name,
              `Duration: ${hoursToWorkingDays(activity.original_duration_hours, hoursPerDay)}`,
              `Float: ${hoursToWorkingDays(activity.total_float_hours, hoursPerDay)}`,
              `Start: ${startDate.toLocaleDateString()}`,
              `Finish: ${finishDate.toLocaleDateString()}`
            ].join('\n');

            setTooltip({
              x: e.clientX,
              y: e.clientY,
              content
            });
            return;
          }
        }
      }
    }

    setTooltip(null);
  }

  function handleMouseDown(e: React.MouseEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const y = e.clientY - rect.top;
    setHasMoved(false);

    if (y < HEADER_HEIGHT) {
      setIsZooming(true);
      setZoomStart({
        x: e.clientX,
        initialZoom: layout.viewSettings.zoom
      });
      e.preventDefault();
    } else {
      setIsPanning(true);
      setPanStart({
        x: e.clientX,
        y: e.clientY,
        scrollLeft: scrollContainerRef.current?.scrollLeft || 0
      });
      e.preventDefault();
    }
  }

  function handleMouseUp(e: React.MouseEvent) {
    const wasPanning = isPanning;
    const wasZooming = isZooming;
    const didMove = hasMoved;

    setIsPanning(false);
    setIsZooming(false);
    setHasMoved(false);

    if (didMove) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !onActivitySelect) return;

    const x = e.clientX - rect.left + scrollLeft;
    const y = e.clientY - rect.top + scrollTop;

    if (y < HEADER_HEIGHT) return;

    const rowIndex = Math.floor((y - HEADER_HEIGHT) / ROW_HEIGHT);
    const visibleItem = visibleGroupedActivities[rowIndex];

    if (visibleItem?.type === 'activity' && visibleItem.activity) {
      const activity = visibleItem.activity;
      const { startDate, finishDate } = getEffectiveDates(activity, dataDate);

      if (!startDate || !finishDate) return;

      const barX1 = dateToX(startDate);
      const barX2 = dateToX(finishDate);
      const barY = HEADER_HEIGHT + rowIndex * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;

      if (x >= barX1 && x <= barX2 && y >= barY && y <= barY + BAR_HEIGHT) {
        onActivitySelect(activity);
      }
    }
  }

  function drawTimeline(ctx: CanvasRenderingContext2D, width: number, scrollLeft: number) {
    ctx.fillStyle = '#F9FAFB';
    ctx.fillRect(0, 0, width, HEADER_HEIGHT);

    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, HEADER_HEIGHT - 0.5);
    ctx.lineTo(width, HEADER_HEIGHT - 0.5);
    ctx.stroke();

    const viewStartDate = xToDate(scrollLeft);
    const viewEndDate = xToDate(scrollLeft + width + 200);

    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

    if (layout.viewSettings.timescale === 'month-week-day') {
      let currentDate = new Date(viewStartDate);
      currentDate.setHours(0, 0, 0, 0);

      while (currentDate <= viewEndDate) {
        const x = dateToX(currentDate) - scrollLeft;
        if (x >= -50 && x <= width) {
          ctx.fillStyle = '#9CA3AF';
          ctx.textAlign = 'left';
          ctx.fillText(currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), x + 4, 25);

          ctx.strokeStyle = currentDate.getDate() === 1 ? '#D1D5DB' : '#F3F4F6';
          ctx.lineWidth = currentDate.getDate() === 1 ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, viewportSize.height);
          ctx.stroke();
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    } else {
      let currentDate = new Date(viewStartDate.getFullYear(), viewStartDate.getMonth(), 1);

      while (currentDate <= viewEndDate) {
        const x = dateToX(currentDate) - scrollLeft;

        if (x >= -200 && x <= width) {
          ctx.fillStyle = '#9CA3AF';
          ctx.textAlign = 'left';
          ctx.fillText(currentDate.toLocaleDateString('en-US', { year: 'numeric' }), x + 4, 15);

          ctx.fillStyle = '#374151';
          ctx.fillText(currentDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), x + 4, 32);

          ctx.strokeStyle = '#D1D5DB';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, HEADER_HEIGHT);
          ctx.stroke();
        }

        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      let weekDate = new Date(viewStartDate);
      weekDate.setDate(weekDate.getDate() - weekDate.getDay());

      ctx.strokeStyle = '#F3F4F6';
      ctx.lineWidth = 1;

      while (weekDate <= viewEndDate) {
        const x = dateToX(weekDate) - scrollLeft;

        if (x >= 0 && x <= width) {
          ctx.beginPath();
          ctx.moveTo(x + 0.5, HEADER_HEIGHT);
          ctx.lineTo(x + 0.5, viewportSize.height);
          ctx.stroke();
        }

        weekDate.setDate(weekDate.getDate() + 7);
      }
    }
  }

  function drawHorizontalGridlines(ctx: CanvasRenderingContext2D, scrollTop: number, height: number) {
    ctx.strokeStyle = '#F3F4F6';
    ctx.lineWidth = 1;

    const startIndex = Math.floor(scrollTop / ROW_HEIGHT);
    const visibleCount = Math.ceil((height - HEADER_HEIGHT) / ROW_HEIGHT) + 1;
    const endIndex = startIndex + visibleCount;

    for (let i = startIndex; i <= endIndex; i++) {
      const y = HEADER_HEIGHT + (i * ROW_HEIGHT) - scrollTop;
      if (y >= HEADER_HEIGHT && y <= height) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(viewportSize.width, y + 0.5);
        ctx.stroke();
      }
    }
  }

  function drawActivities(ctx: CanvasRenderingContext2D, scrollTop: number, scrollLeft: number, height: number) {
    visibleGroupedActivities.forEach((item, index) => {
      const y = HEADER_HEIGHT + (index * ROW_HEIGHT) - scrollTop;

      if (y + ROW_HEIGHT < HEADER_HEIGHT || y > height) return;

      if (item.type === 'group' && layout.grouping.showSummaryBars && item.activities && item.activities.length > 0) {
        let minStart: Date | null = null;
        let maxFinish: Date | null = null;

        item.activities.forEach(act => {
          const { start, finish } = getEffectiveDates(act);
          if (start && (!minStart || start < minStart)) minStart = start;
          if (finish && (!maxFinish || finish > maxFinish)) maxFinish = finish;
        });

        if (minStart && maxFinish) {
          const x1 = dateToX(minStart) - scrollLeft;
          const x2 = dateToX(maxFinish) - scrollLeft;
          const summaryBarHeight = 8;
          const barY = y + (ROW_HEIGHT - summaryBarHeight) / 2;

          ctx.fillStyle = '#6B7280';
          ctx.strokeStyle = '#4B5563';
          ctx.lineWidth = 2;
          ctx.fillRect(x1, barY, Math.max(2, x2 - x1), summaryBarHeight);
          ctx.strokeRect(x1, barY, Math.max(2, x2 - x1), summaryBarHeight);
        }
        return;
      }

      if (item.type === 'activity') {
        const activity = item.activity!;

        const { start: startDate, finish: finishDate } = getEffectiveDates(activity);
        if (!startDate || !finishDate) return;

        const x1 = dateToX(startDate) - scrollLeft;
        const x2 = dateToX(finishDate) - scrollLeft;

        const isActivityMilestone = isMilestone(activity);
        const { fill, outline } = getBarColors(activity);

        if (isActivityMilestone) {
          const centerX = x1;
          const centerY = y + ROW_HEIGHT / 2;
          const size = 8;

          ctx.fillStyle = fill;
          ctx.strokeStyle = outline;
          ctx.lineWidth = 3;

          ctx.beginPath();
          ctx.moveTo(centerX, centerY - size);
          ctx.lineTo(centerX + size, centerY);
          ctx.lineTo(centerX, centerY + size);
          ctx.lineTo(centerX - size, centerY);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#374151';
          ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(activity.activity_name, centerX + size + 6, centerY + 4);
        } else {
          const barY = y + (ROW_HEIGHT - BAR_HEIGHT) / 2;
          const barWidth = Math.max(2, x2 - x1);

          let progressWidth = 0;
          if (dataDate) {
            const dataDateObj = new Date(dataDate);

            if (activity.activity_status === 'complete') {
              progressWidth = barWidth;
            } else if (activity.activity_status === 'in_progress') {
              if (dataDateObj > startDate) {
                const progressX = dateToX(dataDateObj) - scrollLeft;
                progressWidth = Math.max(0, Math.min(progressX - x1, barWidth));
              }
            }
          }

          ctx.fillStyle = fill;
          ctx.fillRect(x1, barY, barWidth, BAR_HEIGHT);

          if (progressWidth > 0) {
            ctx.fillStyle = 'rgba(27, 79, 114, 0.3)';
            ctx.fillRect(x1, barY, progressWidth, BAR_HEIGHT);
          }

          ctx.strokeStyle = outline;
          ctx.lineWidth = 3;
          ctx.strokeRect(x1, barY, barWidth, BAR_HEIGHT);

          if (progressWidth > 0) {
            ctx.strokeStyle = '#1B4F72';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x1, barY);
            ctx.lineTo(x1 + progressWidth, barY);
            ctx.lineTo(x1 + progressWidth, barY + BAR_HEIGHT);
            ctx.lineTo(x1, barY + BAR_HEIGHT);
            ctx.stroke();
          }

          if (layout.viewSettings.showFloat && activity.total_float_hours && activity.total_float_hours > 0) {
            const calendar = calendarMap.get(activity.calendar_id || '');
            const floatDays = activity.total_float_hours / (calendar?.hours_per_day || 8);
            const floatWidth = floatDays * pixelsPerDay;

            ctx.strokeStyle = '#6B7280';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const floatY = barY + BAR_HEIGHT + 3;
            ctx.moveTo(x2, floatY);
            ctx.lineTo(x2 + floatWidth, floatY);
            ctx.stroke();
          }

          ctx.fillStyle = '#374151';
          ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(activity.activity_name, x2 + 6, barY + BAR_HEIGHT / 2 + 4);
        }
      }
    });
  }

  function drawRelationships(ctx: CanvasRenderingContext2D, scrollTop: number, scrollLeft: number) {
    let relsToShow = relationships;

    if (layout.viewSettings.showRelationships === 'selected' && selectedActivity) {
      relsToShow = relationships.filter(r =>
        r.predecessor_activity_id === selectedActivity.id ||
        r.successor_activity_id === selectedActivity.id
      );
    }

    // Determine if a relationship is driving using a fallback chain:
    //   1. If is_driving is explicitly set in the database, use it
    //   2. If relationship_float_hours === 0 (or very close to 0), it's driving
    //   3. If relationship_float_hours is null (not computed), fall back to checking
    //      whether the successor activity has zero total float (i.e. is on the critical path)
    //      AND it's the predecessor with the latest finish date for that successor
    function isDriving(rel: Relationship): boolean {
      // Explicit database value takes priority
      if (rel.is_driving === true) return true;
      if (rel.is_driving === false) return false;

      // Check relationship float (0 = driving, the predecessor that constrains the successor)
      if (rel.relationship_float_hours !== null && rel.relationship_float_hours !== undefined) {
        return Math.abs(rel.relationship_float_hours) < 0.01; // effectively zero
      }

      // Fallback: if successor is on the critical path (zero total float),
      // consider this relationship driving. This is an approximation —
      // in a schedule with multiple predecessors to the same critical activity,
      // only one is truly driving, but this gives a reasonable visual indicator.
      const succ = activityMap.get(rel.successor_activity_id);
      if (succ && succ.total_float_hours !== null && Math.abs(succ.total_float_hours) < 0.01) {
        return true;
      }

      return false;
    }

    const filteredRels = layout.viewSettings.showDrivingOnly
      ? relsToShow.filter(r => isDriving(r))
      : relsToShow;

    // Minimum horizontal stub length out of predecessor / into successor
    const STUB = 8;
    const ARROW_SIZE = 5;

    filteredRels.forEach(rel => {
      const pred = activityMap.get(rel.predecessor_activity_id);
      const succ = activityMap.get(rel.successor_activity_id);

      if (!pred || !succ) return;

      const predDates = getEffectiveDates(pred);
      const succDates = getEffectiveDates(succ);

      if (!predDates.start || !predDates.finish || !succDates.start || !succDates.finish) return;

      const predIndex = visibleGroupedActivities.findIndex(item => item.type === 'activity' && item.activity?.id === pred.id);
      const succIndex = visibleGroupedActivities.findIndex(item => item.type === 'activity' && item.activity?.id === succ.id);

      if (predIndex === -1 || succIndex === -1) return;

      // Y positions: center of each activity row
      const predY = HEADER_HEIGHT + (predIndex * ROW_HEIGHT) + ROW_HEIGHT / 2 - scrollTop;
      const succY = HEADER_HEIGHT + (succIndex * ROW_HEIGHT) + ROW_HEIGHT / 2 - scrollTop;

      // X positions depend on relationship type (FS, SS, FF, SF)
      const predStart = dateToX(predDates.start) - scrollLeft;
      const predFinish = dateToX(predDates.finish) - scrollLeft;
      const succStart = dateToX(succDates.start) - scrollLeft;
      const succFinish = dateToX(succDates.finish) - scrollLeft;

      // Determine departure point (from predecessor) and arrival point (to successor)
      // based on relationship type: FS, SS, FF, SF
      const relType = (rel.relationship_type || 'FS').toUpperCase();
      let fromX: number;
      let toX: number;
      let arrowDirection: 'right' | 'left';

      if (relType === 'FS' || relType === 'PR_FS') {
        fromX = predFinish;
        toX = succStart;
        arrowDirection = 'right';
      } else if (relType === 'SS' || relType === 'PR_SS') {
        fromX = predStart;
        toX = succStart;
        arrowDirection = 'right';
      } else if (relType === 'FF' || relType === 'PR_FF') {
        fromX = predFinish;
        toX = succFinish;
        arrowDirection = 'left';
      } else if (relType === 'SF' || relType === 'PR_SF') {
        fromX = predStart;
        toX = succFinish;
        arrowDirection = 'left';
      } else {
        fromX = predFinish;
        toX = succStart;
        arrowDirection = 'right';
      }

      // Determine if this specific relationship is driving
      const relIsDriving = isDriving(rel);

      // Color scheme:
      //   Driving + successor on critical path → solid red (#E74C3C)
      //   Driving + successor NOT on critical path → solid blue (#1B4F72)
      //   Non-driving → dotted blue (#6B9BD1)
      const succIsCritical = succ.is_critical === true ||
        (succ.total_float_hours !== null && Math.abs(succ.total_float_hours) < 0.01);

      let lineColor: string;
      if (relIsDriving && succIsCritical) {
        lineColor = '#E74C3C'; // red — driving + critical successor
      } else if (relIsDriving) {
        lineColor = '#1B4F72'; // dark navy — driving + non-critical successor
      } else {
        lineColor = '#6B9BD1'; // light blue — non-driving
      }

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = relIsDriving ? 2 : 1;
      ctx.setLineDash(relIsDriving ? [] : [4, 3]); // solid if driving, dotted if not

      ctx.beginPath();

      // Orthogonal routing: horizontal stub → vertical drop → horizontal to target
      const departsFromFinish = (relType === 'FS' || relType === 'PR_FS' || relType === 'FF' || relType === 'PR_FF');
      const stubDirection = departsFromFinish ? 1 : -1;

      if (arrowDirection === 'right') {
        const stubEndX = fromX + (STUB * stubDirection);

        if (stubEndX + STUB <= toX) {
          // Simple case: enough horizontal room
          ctx.moveTo(fromX, predY);
          ctx.lineTo(stubEndX, predY);
          ctx.lineTo(stubEndX, succY);
          ctx.lineTo(toX, succY);
        } else {
          // Tight case: route around
          const detourY = predY + (succY > predY ? 1 : -1) * (ROW_HEIGHT / 2 + 2);
          ctx.moveTo(fromX, predY);
          ctx.lineTo(stubEndX, predY);
          ctx.lineTo(stubEndX, detourY);
          ctx.lineTo(toX - STUB, detourY);
          ctx.lineTo(toX - STUB, succY);
          ctx.lineTo(toX, succY);
        }
      } else {
        // Arrow points left (into a finish): FF or SF
        const stubEndX = fromX + (STUB * stubDirection);
        const arriveStubX = toX + STUB;
        ctx.moveTo(fromX, predY);
        ctx.lineTo(stubEndX, predY);
        const vertX = Math.max(stubEndX, arriveStubX);
        ctx.lineTo(vertX, predY);
        ctx.lineTo(vertX, succY);
        ctx.lineTo(toX, succY);
      }

      ctx.stroke();
      ctx.setLineDash([]); // reset dash pattern

      // Draw arrowhead (always solid, matching line color)
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      if (arrowDirection === 'right') {
        ctx.moveTo(toX, succY);
        ctx.lineTo(toX - ARROW_SIZE, succY - ARROW_SIZE);
        ctx.lineTo(toX - ARROW_SIZE, succY + ARROW_SIZE);
      } else {
        ctx.moveTo(toX, succY);
        ctx.lineTo(toX + ARROW_SIZE, succY - ARROW_SIZE);
        ctx.lineTo(toX + ARROW_SIZE, succY + ARROW_SIZE);
      }
      ctx.closePath();
      ctx.fill();
    });
  }

  function drawDataDateLine(ctx: CanvasRenderingContext2D, scrollLeft: number, height: number) {
    if (!dataDate) return;

    const date = new Date(dataDate);
    const x = dateToX(date) - scrollLeft;

    if (x < 0 || x > viewportSize.width) return;

    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, HEADER_HEIGHT);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();

    ctx.fillStyle = '#3B82F6';
    ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DATA DATE', x, HEADER_HEIGHT - 5);
  }

  function drawTodayLine(ctx: CanvasRenderingContext2D, scrollLeft: number, height: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const x = dateToX(today) - scrollLeft;

    if (x < 0 || x > viewportSize.width) return;

    ctx.strokeStyle = '#DC2626';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, HEADER_HEIGHT);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#DC2626';
    ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TODAY', x, HEADER_HEIGHT - 5);
  }

  const totalHeight = visibleGroupedActivities.length * ROW_HEIGHT + HEADER_HEIGHT;

  return (
    <div ref={containerRef} className="h-full w-full bg-white overflow-hidden relative">
      <div
        ref={scrollContainerRef}
        className="w-full h-full overflow-x-hidden overflow-y-auto"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <div style={{ width: timelineWidth, height: totalHeight }} />
      </div>
      <div
        className="absolute top-0 left-0 w-full h-full"
        style={{
          zIndex: 10,
          pointerEvents: 'none'
        }}
      >
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0"
          style={{
            cursor: isPanning ? 'grabbing' : 'default',
            pointerEvents: 'auto'
          }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            setTooltip(null);
            setIsPanning(false);
            setIsZooming(false);
            setHasMoved(false);
          }}
          onWheel={(e) => {
            if (scrollContainerRef.current) {
              scrollContainerRef.current.scrollLeft += e.deltaX;
              scrollContainerRef.current.scrollTop += e.deltaY;
            }
          }}
        />
      </div>

      {tooltip && (
        <div
          className="fixed bg-gray-900 text-white text-xs rounded px-3 py-2 pointer-events-none z-50 whitespace-pre-line shadow-lg"
          style={{
            left: tooltip.x + 10,
            top: tooltip.y + 10,
            maxWidth: '300px'
          }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
}
