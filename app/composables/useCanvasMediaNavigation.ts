import type { InjectionKey } from 'vue'

export const canvasMediaNavigationKey: InjectionKey<(url: string) => Promise<void>> = Symbol('canvas-media-navigation')

export function useCanvasMediaNavigation() {
  return inject(canvasMediaNavigationKey, undefined)
}
