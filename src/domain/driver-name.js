function normalizeDriverName(value) {
  return String(value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim().replace(/\s+/g, ' ');
}

function driverNamesMatch(accountName, assignedName) {
  const account = normalizeDriverName(accountName), assigned = normalizeDriverName(assignedName);
  if (!account || !assigned) return false;
  if (account === assigned) return true;
  const left = account.split(' '), right = assigned.split(' ');
  const shorter = left.length <= right.length ? left : right, longer = left.length <= right.length ? right : left;
  return shorter.length >= 2 && shorter.every((token, index) => token === longer[index]);
}

module.exports = { normalizeDriverName, driverNamesMatch };
