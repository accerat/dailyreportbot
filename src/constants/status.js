export const STATUS = {
  UPCOMING: 'upcoming',
  IN_PROGRESS: 'in_progress',
  LEAVING_INCOMPLETE: 'leaving_incomplete',
  COMPLETE_NO_GOBACKS: 'complete_no_gobacks',
};

export const STATUS_LABEL = {
  [STATUS.UPCOMING]: 'Upcoming',
  [STATUS.IN_PROGRESS]: 'In Progress',
  [STATUS.LEAVING_INCOMPLETE]: 'Leaving & Incomplete',
  [STATUS.COMPLETE_NO_GOBACKS]: '100% Complete – No Gobacks',
};

export function normalizeStatus(s) {
  if (!s) return STATUS.UPCOMING;
  const key = String(s).toLowerCase().trim().replace(/[\s\-]/g, '_');
  if (Object.values(STATUS).includes(key)) return key;

  // Map old/deprecated statuses to new ones
  if (key === 'started') return STATUS.UPCOMING;
  if (key === 'on_hold' || key === 'onhold' || key === 'hold' || key === 'blocked') return STATUS.IN_PROGRESS;
  if (key === 'open') return STATUS.IN_PROGRESS;
  if (key === 'closed') return STATUS.COMPLETE_NO_GOBACKS;

  return STATUS.UPCOMING;
}
