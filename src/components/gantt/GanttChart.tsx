import { useRef, useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

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

interface GanttChartProps {
  activities: Activity[];
  calendars: Calendar[];
  selectedActivity: Activity | null;
  dataDate: string | null;
  scheduleVersionId: string;
}

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 40;
const OVERSCAN = 5;
const BAR_HEIGHT = 20;
const PIXELS_PER_DAY = 40;

interface TooltipData {
  activity: Activity;
  x: number;
  y: number;
  drivingPredecessors: Array<{ id: string; name: string }>;
  drivingSuccessors: Array<{ id: string; name: string }>;
}

export default function GanttChart({ activities, calendars, selectedActivity, dataDate, scheduleVersionId }: GanttChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const calendarMap = useMemo(() => {
    const map = new Map<string, Calendar>();
    calendars.forEach(cal => map.set(cal.id, cal));
    return map;
  }, [calendars]);

  useEffect(() => {
    async function loadRelationships() {
      if (!scheduleVersionId) return;

      const { data } = await supabase
        .from('cpm_relationships')
        .select('predecessor_activity_id, successor_activity_id, relationship_type, is_driving')
        .eq('schedule_version_id', scheduleVersionId);

      if (data) {
        setRelationships(data);
      }
    }

    loadRelationships();
  }, [scheduleVersionId]);

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
    const width = Math.max(days * PIXELS_PER_DAY, 2000);

    return { minDate: min, maxDate: max, timelineWidth: width };
  }, [activities]);

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
    function handleGotoDate(e: Event) {
      const customEvent = e as CustomEvent;
      const targetDate = new Date(customEvent.detail);
      const dayOffset = (targetDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24);
      const xPos = dayOffset * PIXELS_PER_DAY;

      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollLeft = xPos - viewportSize.width / 2;
      }
    }

    window.addEventListener('gantt-goto-date', handleGotoDate);
    return () => window.removeEventListener('gantt-goto-date', handleGotoDate);
  }, [minDate, viewportSize.width]);

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
    drawActivities(ctx, scrollTop, scrollLeft, viewportSize.height);
    drawDataDateLine(ctx, scrollLeft, viewportSize.height);
    drawTodayLine(ctx, scrollLeft, viewportSize.height);
  }, [activities, selectedActivity, scrollTop, scrollLeft, viewportSize, minDate, dataDate, timelineWidth]);

  function dateToX(date: Date): number {
    const dayOffset = (date.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24);
    return dayOffset * PIXELS_PER_DAY;
  }

  function isMilestone(activity: Activity): boolean {
    return activity.activity_type === 'start_milestone' ||
           activity.activity_type === 'finish_milestone' ||
           activity.original_duration_hours === 0;
  }

  function getWorkingDays(hours: number | null, calendarId: string | null): number {
    if (hours === null || hours === undefined) return 0;
    if (hours === 0) return 0;
    const calendar = calendarId ? calendarMap.get(calendarId) : null;
    const hoursPerDay = calendar?.hours_per_day || 8;
    return Math.round(hours / hoursPerDay);
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const day = date.getDate().toString().padStart(2, '0');
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const year = date.getFullYear().toString().slice(-2);
    return `${day}-${month}-${year}`;
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

    const viewStartDate = new Date(minDate.getTime() + (scrollLeft / PIXELS_PER_DAY) * (1000 * 60 * 60 * 24));
    const viewEndDate = new Date(viewStartDate.getTime() + ((width + 100) / PIXELS_PER_DAY) * (1000 * 60 * 60 * 24));

    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

    let currentDate = new Date(viewStartDate.getFullYear(), viewStartDate.getMonth(), 1);
    if (currentDate > viewStartDate) {
      currentDate.setMonth(currentDate.getMonth() - 1);
    }

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
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visibleCount = Math.ceil((height - HEADER_HEIGHT) / ROW_HEIGHT);
    const endIndex = Math.min(activities.length, startIndex + visibleCount + OVERSCAN * 2);

    for (let i = startIndex; i < endIndex; i++) {
      const activity = activities[i];
      const y = HEADER_HEIGHT + (i * ROW_HEIGHT) - scrollTop;

      if (!activity.early_start || !activity.early_finish) continue;

      const startDate = new Date(activity.early_start);
      const finishDate = new Date(activity.early_finish);

      const x1 = dateToX(startDate) - scrollLeft;
      const x2 = dateToX(finishDate) - scrollLeft;

      const isActivityMilestone = isMilestone(activity);
      const isSelected = selectedActivity?.id === activity.id;
      const isCritical = activity.is_critical === true;

      if (isActivityMilestone) {
        const centerX = x1;
        const centerY = y + ROW_HEIGHT / 2;
        const size = 8;

        if (isSelected) {
          ctx.fillStyle = '#FEF3C7';
          ctx.strokeStyle = '#F59E0B';
        } else if (isCritical) {
          ctx.fillStyle = '#FEE2E2';
          ctx.strokeStyle = '#DC2626';
        } else {
          ctx.fillStyle = '#E0F2FE';
          ctx.strokeStyle = '#0284C7';
        }
        ctx.lineWidth = 2;

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

        if (isSelected) {
          ctx.fillStyle = '#FEF3C7';
          ctx.strokeStyle = '#F59E0B';
        } else if (isCritical) {
          ctx.fillStyle = '#FEE2E2';
          ctx.strokeStyle = '#DC2626';
        } else {
          ctx.fillStyle = '#DCFCE7';
          ctx.strokeStyle = '#16A34A';
        }
        ctx.lineWidth = 2;

        ctx.fillRect(x1, barY, barWidth, BAR_HEIGHT);
        ctx.strokeRect(x1, barY, barWidth, BAR_HEIGHT);

        ctx.fillStyle = '#374151';
        ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(activity.activity_name, x2 + 6, barY + BAR_HEIGHT / 2 + 4);
      }
    }
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

  function handleCanvasMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + scrollLeft;
    const mouseY = e.clientY - rect.top + scrollTop;

    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visibleCount = Math.ceil((viewportSize.height - HEADER_HEIGHT) / ROW_HEIGHT);
    const endIndex = Math.min(activities.length, startIndex + visibleCount + OVERSCAN * 2);

    let foundActivity: Activity | null = null;
    let foundY = 0;

    for (let i = startIndex; i < endIndex; i++) {
      const activity = activities[i];
      const y = HEADER_HEIGHT + (i * ROW_HEIGHT) - scrollTop;

      if (!activity.early_start || !activity.early_finish) continue;

      const startDate = new Date(activity.early_start);
      const finishDate = new Date(activity.early_finish);
      const x1 = dateToX(startDate);
      const x2 = dateToX(finishDate);

      const isActivityMilestone = isMilestone(activity);

      if (isActivityMilestone) {
        const centerX = x1;
        const centerY = y + ROW_HEIGHT / 2;
        const size = 8;

        if (Math.abs(mouseX - centerX) <= size && Math.abs(mouseY - centerY) <= size) {
          foundActivity = activity;
          foundY = y;
          break;
        }
      } else {
        const barY = y + (ROW_HEIGHT - BAR_HEIGHT) / 2;
        const barWidth = Math.max(2, x2 - x1);

        if (mouseX >= x1 && mouseX <= x1 + barWidth && mouseY >= barY && mouseY <= barY + BAR_HEIGHT) {
          foundActivity = activity;
          foundY = y;
          break;
        }
      }
    }

    if (foundActivity) {
      const drivingPreds = relationships
        .filter(r => r.successor_activity_id === foundActivity!.id && r.is_driving === true)
        .map(r => {
          const pred = activityMap.get(r.predecessor_activity_id);
          return pred ? { id: pred.activity_id_display, name: pred.activity_name } : null;
        })
        .filter(Boolean) as Array<{ id: string; name: string }>;

      const drivingSuccs = relationships
        .filter(r => r.predecessor_activity_id === foundActivity!.id && r.is_driving === true)
        .map(r => {
          const succ = activityMap.get(r.successor_activity_id);
          return succ ? { id: succ.activity_id_display, name: succ.activity_name } : null;
        })
        .filter(Boolean) as Array<{ id: string; name: string }>;

      setTooltip({
        activity: foundActivity,
        x: e.clientX,
        y: e.clientY,
        drivingPredecessors: drivingPreds,
        drivingSuccessors: drivingSuccs
      });
    } else {
      setTooltip(null);
    }
  }

  function handleCanvasMouseLeave() {
    setTooltip(null);
  }

  const totalHeight = activities.length * ROW_HEIGHT + HEADER_HEIGHT;

  return (
    <div ref={containerRef} className="h-full w-full bg-white overflow-hidden relative">
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0"
        style={{ zIndex: 10, cursor: tooltip ? 'pointer' : 'default' }}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
      />
      <div
        ref={scrollContainerRef}
        className="w-full h-full overflow-auto"
        style={{ position: 'relative' }}
      >
        <div style={{ width: timelineWidth, height: totalHeight }} />
      </div>

      {tooltip && (
        <div
          className="absolute bg-gray-900 text-white text-xs rounded shadow-lg p-3 pointer-events-none z-50"
          style={{
            left: tooltip.x + 10,
            top: tooltip.y + 10,
            maxWidth: 400
          }}
        >
          <div className="font-semibold mb-2">{tooltip.activity.activity_id_display}</div>
          <div className="mb-2">{tooltip.activity.activity_name}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-gray-300">
            <div>Start:</div>
            <div>{formatDate(tooltip.activity.early_start)}</div>
            <div>Finish:</div>
            <div>{formatDate(tooltip.activity.early_finish)}</div>
            <div>Rem Dur:</div>
            <div>{getWorkingDays(tooltip.activity.remaining_duration_hours, tooltip.activity.calendar_id)}</div>
            <div>Total Float:</div>
            <div>{getWorkingDays(tooltip.activity.total_float_hours, tooltip.activity.calendar_id)}</div>
          </div>
          {tooltip.drivingPredecessors.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-700">
              <div className="font-semibold mb-1">Driving Predecessors:</div>
              {tooltip.drivingPredecessors.map((pred, idx) => (
                <div key={idx} className="text-gray-300 ml-2">
                  {pred.id}: {pred.name}
                </div>
              ))}
            </div>
          )}
          {tooltip.drivingSuccessors.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-700">
              <div className="font-semibold mb-1">Driving Successors:</div>
              {tooltip.drivingSuccessors.map((succ, idx) => (
                <div key={idx} className="text-gray-300 ml-2">
                  {succ.id}: {succ.name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
