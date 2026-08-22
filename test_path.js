function getDirectoryName(path) {
  if (!path || path === '' || path === '/' || path.match(/^[A-Za-z]:\?$/)) return path.replace(/\$/, '');
  const parts = path.split(/[/\]/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || '/';
  return parts.slice(0, -1).join('\');
}

console.log('Test cases:');
console.log('H://Muse Code复刻 =>', JSON.stringify(getDirectoryName('H://Muse Code复刻')));
console.log('H:// =>', JSON.stringify(getDirectoryName('H://')));
console.log('C://Users//Administrator =>', JSON.stringify(getDirectoryName('C://Users//Administrator')));
console.log('C:// =>', JSON.stringify(getDirectoryName('C://')));
