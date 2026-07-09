// Taste Finder — Google Maps export parser (runs in browser)

const Parser = {
  parse(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        const ext = file.name.split(".").pop().toLowerCase();
        try {
          let places;
          if (ext === "json") places = this.parseJSON(text);
          else if (ext === "kml" || ext === "xml") places = this.parseKML(text);
          else if (ext === "csv") places = this.parseCSV(text);
          else {
            try { places = this.parseJSON(text); }
            catch { places = this.parseKML(text); }
          }
          resolve(this.normalize(places));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  },

  parseJSON(text) {
    const data = JSON.parse(text);
    const places = [];
    // Top-level list
    if (Array.isArray(data)) {
      for (const item of data) {
        places.push({
          name: item.Title || item.title || item.name || "",
          address: item.Address || item.address || "",
          category: item.Category || item.category || "",
          note: item.note || "",
          lat: item.Latitude || item.lat || null,
          lng: item.Longitude || item.lng || null,
        });
      }
      return places;
    }
    // GeoJSON FeatureCollection
    for (const feat of data.features || []) {
      const props = feat.properties || {};
      const coords = (feat.geometry || {}).coordinates || [null, null];
      places.push({
        name: props.Title || props.name || props.title || "",
        address: props.address || "",
        category: props.Category || props.category || "",
        note: props.note || "",
        lat: coords[1],
        lng: coords[0],
      });
    }
    return places;
  },

  parseKML(text) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/xml");
    const places = [];
    const placemarks = doc.getElementsByTagName("Placemark");
    for (const pm of placemarks) {
      const name = pm.getElementsByTagName("name")[0]?.textContent?.trim() || "";
      const addr = pm.getElementsByTagName("address")[0]?.textContent?.trim() || "";
      const desc = pm.getElementsByTagName("description")[0]?.textContent?.trim() || "";
      const point = pm.getElementsByTagName("Point")[0];
      let lat = null, lng = null;
      if (point) {
        const coords = point.getElementsByTagName("coordinates")[0]?.textContent?.trim();
        if (coords) {
          const parts = coords.split(",");
          lng = parseFloat(parts[0]);
          lat = parseFloat(parts[1]);
        }
      }
      places.push({ name, address: addr, category: "", note: desc, lat, lng });
    }
    return places;
  },

  parseCSV(text) {
    const lines = text.split("\n").filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
    const places = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(",");
      const row = {};
      headers.forEach((h, idx) => row[h] = (vals[idx] || "").trim());
      places.push({
        name: row.name || "",
        address: row.address || "",
        category: row.category || "",
        note: row.note || "",
        lat: row.lat ? parseFloat(row.lat) : null,
        lng: row.lng ? parseFloat(row.lng) : null,
      });
    }
    return places;
  },

  normalize(places) {
    const seen = new Set();
    return places.filter(p => {
      const name = (p.name || "").trim();
      if (!name || seen.has(name.toLowerCase())) return false;
      seen.add(name.toLowerCase());
      p.name = name;
      return true;
    });
  },
};
