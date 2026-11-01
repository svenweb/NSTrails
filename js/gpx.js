// GPX import/export.
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function routeToGpx(name, coords, ele) {
  const pts = coords
    .map((c, i) => `<rtept lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">${ele?.[i] != null ? `<ele>${ele[i].toFixed(1)}</ele>` : ''}</rtept>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="North Shore Trails" xmlns="http://www.topografix.com/GPX/1/1">
<rte><name>${esc(name)}</name>
${pts}
</rte></gpx>`;
}

export function trackToGpx(name, points) {
  const pts = points
    .map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${p.alt != null ? `<ele>${p.alt.toFixed(1)}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time></trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="North Shore Trails" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${esc(name)}</name><trkseg>
${pts}
</trkseg></trk></gpx>`;
}

// Returns {name, coords} from the first track or route in a GPX file.
export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const name = doc.querySelector('trk > name, rte > name, metadata > name')?.textContent || 'Imported route';
  let pts = [...doc.querySelectorAll('trkpt')];
  if (!pts.length) pts = [...doc.querySelectorAll('rtept')];
  if (!pts.length) pts = [...doc.querySelectorAll('wpt')];
  const coords = pts.map((p) => [parseFloat(p.getAttribute('lon')), parseFloat(p.getAttribute('lat'))]).filter((c) => !isNaN(c[0]) && !isNaN(c[1]));
  return { name, coords };
}

export function downloadFile(filename, text, type = 'application/gpx+xml') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
