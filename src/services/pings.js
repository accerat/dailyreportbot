export async function maybePingOnReport({
  channel, blockers, healthScore, statusChangedTo,
  roleIds = {},
}) {
  const {
    COO_ROLE_ID,
    FINANCE_ROLE_ID,
    LODGING_ROLE_ID,
    MLB_OFFICE_ROLE_ID,
  } = roleIds;

  const reasons = [];
  const mentions = new Set();

  if ((blockers && blockers.trim()) || (Number(healthScore) <= 2)) {
    if (COO_ROLE_ID) mentions.add(`<@&${COO_ROLE_ID}>`);
    if (Number(healthScore) <= 2) reasons.push(`Low health (${healthScore})`);
    if (blockers && blockers.trim()) reasons.push('Blockers reported');
  }

  if (statusChangedTo === 'leaving_incomplete' || statusChangedTo === 'complete_no_gobacks') {
    if (MLB_OFFICE_ROLE_ID) mentions.add(`<@&${MLB_OFFICE_ROLE_ID}>`);
    if (FINANCE_ROLE_ID) mentions.add(`<@&${FINANCE_ROLE_ID}>`);
    if (LODGING_ROLE_ID) mentions.add(`<@&${LODGING_ROLE_ID}>`);
    reasons.push(statusChangedTo === 'leaving_incomplete' ? 'Leaving & Incomplete' : 'Complete – No Gobacks');
  }

  if (!mentions.size) return;
  const reasonText = reasons.join(' • ') || 'Update';
  await channel.send({
    content: `${Array.from(mentions).join(' ')} — ${reasonText}`,
    allowedMentions: { parse: ['roles'] },
  });
}
