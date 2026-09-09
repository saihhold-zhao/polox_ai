export default defineNuxtPlugin(() => {
  const colorMode = useColorMode()

  const forceDark = () => {
    if (colorMode.preference !== 'dark') {
      colorMode.preference = 'dark'
    }
  }

  forceDark()
  watch(() => colorMode.preference, forceDark)
})
