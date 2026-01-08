<template>
  <svg
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <!-- Globe/language icon with translation symbol -->
    <circle
      cx="16"
      cy="16"
      r="14"
      stroke="var(--ui-primary)"
      stroke-width="2"
      fill="none"
    />
    <!-- Horizontal line -->
    <path
      d="M2 16h28"
      stroke="var(--ui-primary)"
      stroke-width="1.5"
    />
    <!-- Vertical ellipse -->
    <ellipse
      cx="16"
      cy="16"
      rx="6"
      ry="14"
      stroke="var(--ui-primary)"
      stroke-width="1.5"
      fill="none"
    />
    <!-- Top curve -->
    <path
      d="M6 8c3 1.5 6.5 2.5 10 2.5s7-1 10-2.5"
      stroke="var(--ui-primary)"
      stroke-width="1.5"
      fill="none"
    />
    <!-- Bottom curve -->
    <path
      d="M6 24c3-1.5 6.5-2.5 10-2.5s7 1 10 2.5"
      stroke="var(--ui-primary)"
      stroke-width="1.5"
      fill="none"
    />
    <!-- "A" character representing translation -->
    <text
      x="16"
      y="19"
      text-anchor="middle"
      font-size="10"
      font-weight="bold"
      fill="var(--ui-primary)"
    >A</text>
  </svg>
</template>
