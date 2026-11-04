export interface Destination {
  id: string
  name: string
  details: string
  coordinates: [longitude: number, latitude: number]
}

export type RouteMode = 'driving' | 'walking' | 'cycling'
export type TollPreference = 'with-tolls' | 'avoid-tolls'

export interface RouteSummary {
  coordinates: [longitude: number, latitude: number][]
  distance: number
  duration: number
  steps: RouteStep[]
}

export interface RouteStep {
  distance: number
  duration: number
  name: string
  maneuver: {
    type: string
    modifier?: string
    location: [longitude: number, latitude: number]
    /** Index du point de la manœuvre dans RouteSummary.coordinates. */
    shapeIndex: number
    exit?: number
  }
}

export interface PhotonProperties {
  osm_id?: number
  osm_type?: string
  name?: string
  housenumber?: string
  street?: string
  postcode?: string
  city?: string
  county?: string
  district?: string
  locality?: string
  state?: string
  country?: string
}

export interface PhotonFeature {
  geometry: {
    type: 'Point'
    coordinates: [longitude: number, latitude: number]
  }
  properties: PhotonProperties
}

export interface PhotonFeatureCollection {
  features: PhotonFeature[]
}
