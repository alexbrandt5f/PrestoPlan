import { useState, useRef, useEffect, ReactNode } from 'react';

interface ResizablePanelsProps {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
  bottomPanel: ReactNode;
}

export default function ResizablePanels({ leftPanel, rightPanel, bottomPanel }: ResizablePanelsProps) {
  const [leftWidth, setLeftWidth] = useState(40);
  const [bottomHeight, setBottomHeight] = useState(30);
  const [isDraggingVertical, setIsDraggingVertical] = useState(false);
  const [isDraggingHorizontal, setIsDraggingHorizontal] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (isDraggingVertical && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
        setLeftWidth(Math.max(20, Math.min(80, newWidth)));
      }
      if (isDraggingHorizontal && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const newHeight = ((rect.bottom - e.clientY) / rect.height) * 100;
        setBottomHeight(Math.max(15, Math.min(60, newHeight)));
      }
    }

    function handleMouseUp() {
      setIsDraggingVertical(false);
      setIsDraggingHorizontal(false);
    }

    if (isDraggingVertical || isDraggingHorizontal) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = isDraggingVertical ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isDraggingVertical, isDraggingHorizontal]);

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col">
      <div className="flex-1 flex overflow-hidden" style={{ height: `${100 - bottomHeight}%` }}>
        <div style={{ width: `${leftWidth}%` }} className="overflow-hidden border-r border-gray-200">
          {leftPanel}
        </div>

        <div
          className="w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize flex-shrink-0 transition-colors"
          onMouseDown={() => setIsDraggingVertical(true)}
        />

        <div className="flex-1 overflow-hidden">
          {rightPanel}
        </div>
      </div>

      <div
        className="h-1 bg-gray-200 hover:bg-blue-400 cursor-row-resize flex-shrink-0 transition-colors"
        onMouseDown={() => setIsDraggingHorizontal(true)}
      />

      <div style={{ height: `${bottomHeight}%` }} className="overflow-auto border-t border-gray-200 bg-white">
        {bottomPanel}
      </div>
    </div>
  );
}
