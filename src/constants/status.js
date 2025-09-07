export const STATUS = {
  STARTED: 'started',
  ON_HOLD: 'on_hold',
  IN_PROGRESS: 'in_progress',
  LEAVING_INCOMPLETE: 'leaving_incomplete',
  COMPLETE_NO_GOBACKS: 'complete_no_gobacks',
};

export const STATUS_LABEL = {
  [STATUS.STARTED]: 'Started',
  [STATUS.ON_HOLD]: 'On Hold',
  [STATUS.IN_PROGRESS]: 'In Progress',
  [STATUS.LEAVING_INCOMPLETE]: 'Leaving & Incomplete',
  [STATUS.COMPLETE_NO_GOBACKS]: '100% Complete – No Gobacks',
};

export function normalizeStatus(s) {
  if (!s) return STATUS.STARTED;
  const key = String(s).toLowerCase().trim();
  if (Object.values(STATUS).includes(key)) return key;
  if (key === 'open') return STATUS.IN_PROGRESS;
  if (key === 'blocked' || key === 'hold' || key === 'onhold') return STATUS.ON_HOLD;
  if (key === 'closed') return STATUS.COMPLETE_NO_GOBACKS;
  return STATUS.STARTED;
}
