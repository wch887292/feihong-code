function getDirectoryName(path) {
  if (!path || path === '' || path === '/') return '/';
  if (/^[A-Za-z]:$/.test(path)) return path + '\';
  if (/^[A-Za-z]:\$/.test(path)) return path;
  const parts = path.split(/[/\]/).filter(Boolean);
  if (parts.length <= 1) {
    const driveMatch = parts[0].match(/^([A-Za-z]):$/);
    if (driveMatch) return driveMatch[1] + ':' + '\';
    return parts[0] || '/';
  }
  const parentParts = parts.slice(0, -1);
  const firstPart = parentParts[0];
  if (/^[A-Za-z]:$/.test(firstPart)) {
    return firstPart + '\' + parentParts.slice(1).join('\');
  }
  return parentParts.join('\');
}

console.log('Test:');
console.log('Input: H://Muse Code复刻');
console.log('Output:', JSON.stringify(getDirectoryName('H://Muse Code复刻')));
console.log('Expected: "H://"');
