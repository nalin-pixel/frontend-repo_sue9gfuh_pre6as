import React, { useEffect, useRef, useState, useMemo } from 'react'
import mapboxgl from 'mapbox-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'

// Access token via env. Set VITE_MAPBOX_TOKEN in .env
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

const royal = {
  bg: 'bg-[#0B1B3B]',
  panel: 'bg-white/95',
  primary: '#1F4AFF',
  accent: '#0EA5E9',
}

const clusterLayer = {
  id: 'clusters',
  type: 'circle',
  source: 'properties',
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': [
      'step',
      ['get', 'point_count'],
      '#1F4AFF',
      50, '#2563eb',
      200, '#0ea5e9'
    ],
    'circle-radius': [
      'step',
      ['get', 'point_count'],
      16,
      50, 22,
      200, 28
    ],
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 2
  }
}

const clusterCountLayer = {
  id: 'cluster-count',
  type: 'symbol',
  source: 'properties',
  filter: ['has', 'point_count'],
  layout: {
    'text-field': ['get', 'point_count_abbreviated'],
    'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
    'text-size': 12
  },
  paint: {
    'text-color': '#ffffff'
  }
}

const unclusteredPointLayer = {
  id: 'unclustered-point',
  type: 'circle',
  source: 'properties',
  filter: ['!', ['has', 'point_count']],
  paint: {
    'circle-color': '#1F4AFF',
    'circle-radius': 6,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff'
  }
}

export default function MapView() {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const drawRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const backend = import.meta.env.VITE_BACKEND_URL

  const geojson = useMemo(() => ({
    type: 'FeatureCollection',
    features: (items || []).map((p) => ({
      type: 'Feature',
      properties: {
        id: p.id,
        title: p.title,
        price: p.price ?? '',
      },
      geometry: p.location
    }))
  }), [items])

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-40, 25],
      zoom: 2
    })
    mapRef.current = map

    // UI polish - royal blue theme for controls
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
      styles: [
        {
          id: 'gl-draw-polygon-fill-inactive', type: 'fill', filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon']],
          paint: { 'fill-color': '#1F4AFF', 'fill-opacity': 0.08 }
        },
        {
          id: 'gl-draw-polygon-stroke-inactive', type: 'line', filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon']],
          paint: { 'line-color': '#1F4AFF', 'line-width': 2 }
        },
        {
          id: 'gl-draw-polygon-fill-active', type: 'fill', filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
          paint: { 'fill-color': '#1F4AFF', 'fill-opacity': 0.12 }
        },
        {
          id: 'gl-draw-polygon-stroke-active', type: 'line', filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
          paint: { 'line-color': '#1F4AFF', 'line-width': 2 }
        }
      ]
    })
    drawRef.current = draw
    map.addControl(draw, 'top-left')

    map.on('load', () => {
      map.addSource('properties', {
        type: 'geojson',
        data: geojson,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 40
      })

      map.addLayer(clusterLayer)
      map.addLayer(clusterCountLayer)
      map.addLayer(unclusteredPointLayer)

      map.on('click', 'clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
        const clusterId = features[0].properties.cluster_id
        map.getSource('properties').getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return
          map.easeTo({ center: features[0].geometry.coordinates, zoom })
        })
      })

      map.on('click', 'unclustered-point', (e) => {
        const feature = e.features?.[0]
        if (!feature) return
        const { title, price } = feature.properties
        new mapboxgl.Popup({ closeButton: false, offset: 12 })
          .setLngLat(feature.geometry.coordinates)
          .setHTML(`<div style="font-weight:600;color:#0B1B3B">${title}</div><div style="color:#1F4AFF">$${price?.toLocaleString?.() || ''}</div>`)
          .addTo(map)
      })

      setLoading(false)
    })

    return () => map.remove()
  }, [])

  // Update source data when items change
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const src = map.getSource('properties')
    if (src) src.setData(geojson)
  }, [geojson])

  useEffect(() => {
    // initial load
    const loadAll = async () => {
      try {
        const res = await fetch(`${backend}/api/properties`)
        const data = await res.json()
        setItems(data.items || [])
      } catch (e) {
        console.error(e)
      }
    }
    loadAll()
  }, [backend])

  // Handle draw search
  const runSearch = async () => {
    const draw = drawRef.current
    if (!draw) return
    const f = draw.getAll()
    const poly = f.features.find((g) => g.geometry.type === 'Polygon')
    if (!poly) return
    try {
      const res = await fetch(`${backend}/api/properties/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ polygon: { type: 'Polygon', coordinates: poly.geometry.coordinates } })
      })
      const data = await res.json()
      setItems(data.items || [])
    } catch (e) { console.error(e) }
  }

  const clearSearch = async () => {
    drawRef.current?.deleteAll()
    const res = await fetch(`${backend}/api/properties`)
    const data = await res.json()
    setItems(data.items || [])
  }

  return (
    <div className={`w-full h-[100dvh] relative ${royal.bg}`}>
      <div ref={mapContainer} className="absolute inset-0" />

      <div className="absolute top-4 left-4 right-4 md:right-auto z-10">
        <div className={`rounded-2xl shadow-xl px-4 py-3 md:px-5 md:py-4 flex items-center gap-3 ${royal.panel}`}>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[#0B1B3B]">Property Map</div>
            <div className="text-xs text-slate-500">Draw on the map to search. Click clusters to zoom in.</div>
          </div>
          <button onClick={runSearch} className="px-3 py-2 rounded-lg text-white" style={{background: royal.primary}}>Search area</button>
          <button onClick={clearSearch} className="px-3 py-2 rounded-lg border border-slate-200 text-[#0B1B3B] bg-white">Clear</button>
        </div>
      </div>
    </div>
  )
}
