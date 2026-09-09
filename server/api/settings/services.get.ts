import { publicServiceStatus } from '../../utils/serviceSettings'

export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  return publicServiceStatus()
})
