export type SidebarSection = 'route' | 'favorites' | 'recent'

export interface CurrentPosition {
  coordinates: [longitude: number, latitude: number]
  accuracy: number
  heading: number | null
  speed: number | null
}
