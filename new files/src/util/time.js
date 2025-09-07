import { DateTime } from 'luxon'; export const CT_ZONE='America/Chicago'; export const nowCT=()=>DateTime.now().setZone(CT_ZONE); export const todayCT=()=>nowCT().toISODate();
