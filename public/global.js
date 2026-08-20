const geoState = window.__KREVUNO_GEO_STATE__ || { lat: 20, lng: 0, radius: 25, located: false };
window.__KREVUNO_GEO_STATE__ = geoState;
let activityLayer = null;

function idle(fn, timeout = 1500) {
  if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout });
  else setTimeout(fn, 250);
}

async function updateLocationLabel(lat, lng) {
  try {
    const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&localityLanguage=en`);
    if (!response.ok) return;
    const data = await response.json();
    const label = [data.locality, data.principalSubdivision, data.countryName].filter(Boolean).join(", ");
    const status = document.getElementById("mapStatus");
    if (status) status.textContent = label ? `Search center: ${label}` : "Search center updated.";
  } catch {}
}

function installGeoFetchBridge() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || "GET").toUpperCase();
      const target = /\/rest\/v1\/(vovyyvov_needs|vovyyvov_availability|vovyyvov_money_missions)/.test(url);
      if (target && method === "POST" && geoState.located && typeof init.body === "string") {
        const body = JSON.parse(init.body);
        body.latitude = Number(geoState.lat);
        body.longitude = Number(geoState.lng);
        body.search_radius_miles = Number(geoState.radius);
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch {}
    return originalFetch(input, init);
  };
}

function initMap() {
  if (!window.L) return;
  document.querySelector("#worldMap .map-loading")?.remove();
  const renderer = L.canvas({ padding: 0.25 });
  const map = L.map("worldMap", {
    worldCopyJump: true,
    minZoom: 1,
    maxZoom: 19,
    preferCanvas: true,
    renderer,
    fadeAnimation: false,
    markerZoomAnimation: false,
    zoomAnimation: true,
  }).setView([geoState.lat, geoState.lng], geoState.located ? 10 : 1);

  const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    minZoom: 1,
    attribution: "© OpenStreetMap contributors",
    detectRetina: false,
    keepBuffer: 1,
    updateWhenIdle: true,
    updateWhenZooming: false,
    crossOrigin: true,
  }).addTo(map);

  const centerMarker = L.circleMarker([geoState.lat, geoState.lng], {
    radius: 7,
    weight: 3,
    fillOpacity: 1,
    renderer,
  }).addTo(map);

  const radiusCircle = L.circle([geoState.lat, geoState.lng], {
    radius: geoState.radius * 1609.344,
    weight: 2,
    fillOpacity: 0.07,
    renderer,
  }).addTo(map);

  const value = document.getElementById("radiusValue");
  const slider = document.getElementById("radiusSlider");
  const status = document.getElementById("mapStatus");
  if (slider) slider.value = geoState.radius;
  if (value) value.textContent = `${geoState.radius} mi`;

  function emitGeo() {
    window.__KREVUNO_GEO_STATE__ = { ...geoState };
    const detail = { ...window.__KREVUNO_GEO_STATE__ };
    window.dispatchEvent(new CustomEvent("vovyyvov:geo-change", { detail }));
    window.dispatchEvent(new CustomEvent("krevuno:geo-change", { detail }));
  }

  function saveCenter(lat, lng, located = true) {
    geoState.lat = lat;
    geoState.lng = lng;
    geoState.located = located;
    centerMarker.setLatLng([lat, lng]);
    radiusCircle.setLatLng([lat, lng]);
    emitGeo();
  }

  function setRadius(v) {
    geoState.radius = Math.max(5, Math.min(500, Number(v) || 25));
    if (value) value.textContent = `${geoState.radius} mi`;
    radiusCircle.setRadius(geoState.radius * 1609.344);
    emitGeo();
  }

  slider?.addEventListener("input", (event) => setRadius(event.target.value));

  map.on("click", (event) => {
    saveCenter(event.latlng.lat, event.latlng.lng, true);
    updateLocationLabel(event.latlng.lat, event.latlng.lng);
  });

  document.getElementById("locateBtn")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      if (status) status.textContent = "Location is not supported in this browser.";
      return;
    }
    if (status) status.textContent = "Requesting your location…";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        saveCenter(latitude, longitude, true);
        map.setView([latitude, longitude], 12, { animate: false });
        updateLocationLabel(latitude, longitude);
      },
      () => {
        if (status) status.textContent = "Location permission was not granted. Click the map to choose a search center.";
      },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 600000 }
    );
  });

  document.getElementById("worldBtn")?.addEventListener("click", () => map.setView([20, 0], 1, { animate: false }));

  const scheduleActivity = () => idle(() => loadActivity(map, renderer), 1200);
  tiles.once("load", scheduleActivity);
  setTimeout(scheduleActivity, 1200);
  window.addEventListener("krevuno:geo-change", scheduleActivity);
  if (geoState.located) idle(() => updateLocationLabel(geoState.lat, geoState.lng), 1200);
  requestAnimationFrame(() => map.invalidateSize({ animate: false }));
}

async function loadActivity(map, renderer) {
  const status = document.getElementById("densityStatus");
  try {
    if (status) status.textContent = "Loading public KREVUNO opportunity activity…";
    const response = await fetch("/api/opportunities/map?limit=250");
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.opportunities) ? payload.opportunities : [];
    if (activityLayer) activityLayer.remove();
    activityLayer = L.layerGroup().addTo(map);
    let count = 0;

    for (const opportunity of rows) {
      const lat = Number(opportunity.latitude);
      const lng = Number(opportunity.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const label = [opportunity.company_name, opportunity.city, opportunity.title].filter(Boolean).join(" • ") || "KREVUNO opportunity";
      L.circleMarker([lat, lng], { radius: 7, weight: 1, fillOpacity: 0.32, renderer })
        .bindTooltip(label)
        .addTo(activityLayer);
      count++;
    }

    if (status) {
      status.textContent = count
        ? `${count} public KREVUNO opportunity locations are visible. Zoom in to explore nearby activity.`
        : "No public location-enabled opportunities are live right now. The world map and search-center controls remain available.";
    }
  } catch {
    if (status) status.textContent = "Live activity could not be loaded right now. The map and search-center controls remain available.";
  }
}

installGeoFetchBridge();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initMap, { once: true });
else initMap();
