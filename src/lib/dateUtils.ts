export function hoursToWorkingDays(hours: number | null, hoursPerDay: number): string {
  if (hours === null || hours === undefined) return '-';
  if (hours === 0) return '0d';
  const days = hours / hoursPerDay;
  return `${days.toFixed(1)}d`;
}

export function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const day = date.getDate().toString().padStart(2, '0');
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const year = date.getFullYear().toString().slice(-2);
  return `${day}-${month}-${year}`;
}
