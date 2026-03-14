import { useRef, useEffect, useState, useMemo } from 'react';
import { useGanttLayout } from '../../contexts/GanttLayoutContext';
import { supabase } from '../../lib/supabase';
import { hoursToWorkingDays } from '../../lib/dateUtils';

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
  codeColors
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

    const selectedIndex = visibleGroupedActivities.findIndex(
      item => item.type === 'activity' && item.activity?.id === selectedActivity.id
    );

    if (selectedIndex === -1) return;

    if (!selectedActivity.early_start || !selectedActivity.early_finish) return;

    const startDate = new Date(selectedActivity.early_start);
    const finishDate = new Date(selectedActivity.early_finish);
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
      .select('predecessor_activity_id, successor_activity_id, relationship_type, is_driving')
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

  const visibleGroupedActivities = useMemo(() => {
    const result: typeof visibleGroupedActivities = [];
    const collapsedStack: Array<{ key: string; level: number }> = [];

    for (const item of visibleGroupedActivities) {
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
  }, [visibleGroupedActivities, collapsedGroups]);

  const { minDate, maxDate, timelineWidth } = useMemo(() => {
    if (activities.length === 0) {
      const now = new Date();
      return { minDate: now, maxDate: now, timelineWidth: 1000 };
    }

    let min = new Date();
    let max = new Date();
    let hasValidDates = false;

    activities.forEach(activity => {
      if (activity.early_start) {
        const start = new Date(activity.early_start);
        if (!hasValidDates || start < min) {
          min = start;
          hasValidDates = true;
        }
      }
      if (activity.early_finish) {
        const finish = new Date(activity.early_finish);
        if (!hasValidDates || finish > max) {
          max = finish;
          hasValidDates = true;
        }
      }
    });

    if (!hasValidDates) {
      const now = new Date();
      return { minDate: now, maxDate: now, timelineWidth: 1000 };
    }

    min.setDate(min.getDate() - 30);
    max.setDate(max.getDate() + 30);

    const days = Math.ceil((max.getTime() - min.getTime()) / (1000 * 60 * 60 * 24));
    const width = Math.max(days * pixelsPerDay, 2000);

    return { minDate: min, maxDate: max, timelineWidth: width };
  }, [activities, pixelsPerDay]);

  useEffect(() => {
    function handleResize() {
      if (containerRef.current) {
        setViewportSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    }

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
      const zoomFactor = 1 + (deltaX / 300);
      const newZoom = Math.max(0.1, Math.min(5, zoomStart.initialZoom * zoomFactor));
      updateViewSettings({ zoom: newZoom });
      return;
    }

    if (isPanning) {
      const scrollContainer = scrollContainerRef.current;
      if (scrollContainer) {
        const deltaX = e.clientX - panStart.x;
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

        if (activity.early_start && activity.early_finish) {
          const startDate = new Date(activity.early_start);
          const finishDate = new Date(activity.early_finish);
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
              `Duration: ${hoursToWorkingDays(activity.original_duration_hours, hoursPerDay)}d`,
              `Float: ${hoursToWorkingDays(activity.total_float_hours, hoursPerDay)}d`,
              `Start: ${new Date(activity.early_start).toLocaleDateString()}`,
              `Finish: ${new Date(activity.early_finish).toLocaleDateString()}`
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

  function handleMouseUp() {
    setIsPanning(false);
    setIsZooming(false);
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
          if (act.early_start) {
            const start = new Date(act.early_start);
            if (!minStart || start < minStart) minStart = start;
          }
          if (act.early_finish) {
            const finish = new Date(act.early_finish);
            if (!maxFinish || finish > maxFinish) maxFinish = finish;
          }
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

        if (!activity.early_start || !activity.early_finish) return;

        const startDate = new Date(activity.early_start);
        const finishDate = new Date(activity.early_finish);

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
          if (dataDate && activity.early_start) {
            const dataDateObj = new Date(dataDate);
            const startDateObj = new Date(activity.early_start);
            if (dataDateObj > startDateObj) {
              const progressX = dateToX(dataDateObj) - scrollLeft;
              progressWidth = Math.max(0, Math.min(progressX - x1, barWidth));
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

    const filteredRels = layout.viewSettings.showDrivingOnly
      ? relsToShow.filter(r => r.is_driving)
      : relsToShow;

    filteredRels.forEach(rel => {
      const pred = activityMap.get(rel.predecessor_activity_id);
      const succ = activityMap.get(rel.successor_activity_id);

      if (!pred || !succ || !pred.early_start || !pred.early_finish || !succ.early_start || !succ.early_finish) return;

      const predIndex = visibleGroupedActivities.findIndex(item => item.type === 'activity' && item.activity?.id === pred.id);
      const succIndex = visibleGroupedActivities.findIndex(item => item.type === 'activity' && item.activity?.id === succ.id);

      if (predIndex === -1 || succIndex === -1) return;

      const predY = HEADER_HEIGHT + (predIndex * ROW_HEIGHT) + ROW_HEIGHT - 2 - scrollTop;
      const succY = HEADER_HEIGHT + (succIndex * ROW_HEIGHT) + ROW_HEIGHT - 2 - scrollTop;

      const predFinish = dateToX(new Date(pred.early_finish)) - scrollLeft;
      const succStart = dateToX(new Date(succ.early_start)) - scrollLeft;

      ctx.strokeStyle = rel.is_driving ? '#4169E1' : '#6B9BD1';
      ctx.lineWidth = rel.is_driving ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(predFinish, predY);

      const distX = succStart - predFinish;
      const distY = Math.abs(succY - predY);
      const maxAngle = 60;
      const tan60 = Math.tan(maxAngle * Math.PI / 180);
      const minHorizontal = distY / tan60;

      if (distX > minHorizontal * 2) {
        const midX = (predFinish + succStart) / 2;
        const controlOffset = Math.min(distX * 0.3, 50);

        ctx.bezierCurveTo(
          predFinish + controlOffset, predY,
          midX - controlOffset, predY,
          midX, (predY + succY) / 2
        );
        ctx.bezierCurveTo(
          midX + controlOffset, succY,
          succStart - controlOffset, succY,
          succStart, succY
        );
      } else {
        const horizontalDist = Math.max(minHorizontal, distX / 2);
        ctx.lineTo(predFinish + horizontalDist, predY);
        ctx.lineTo(succStart - horizontalDist, succY);
        ctx.lineTo(succStart, succY);
      }

      ctx.stroke();

      const arrowSize = 5;
      ctx.fillStyle = rel.is_driving ? '#4169E1' : '#6B9BD1';
      ctx.beginPath();
      ctx.moveTo(succStart, succY);
      ctx.lineTo(succStart - arrowSize, succY - arrowSize);
      ctx.lineTo(succStart - arrowSize, succY + arrowSize);
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
