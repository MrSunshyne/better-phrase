<script setup>
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

const title = 'Better Phrase'
const description = 'A modern interface for managing your Phrase translation projects with ease.'

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  twitterCard: 'summary_large_image'
})
</script>

<template>
  <UApp>
    <NuxtPage class="h-full" />
  </UApp>
</template>

<style>
#__nuxt {
  display:flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
</style>
