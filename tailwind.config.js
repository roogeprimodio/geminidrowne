/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./src/**/*.{js,jsx,ts,tsx}",
        "./index.html"
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                background: 'rgb(var(--color-background) / <alpha-value>)',
                surface: 'rgb(var(--color-surface) / <alpha-value>)',
                "surface-light": 'rgb(var(--color-surface-light) / <alpha-value>)',
                "surface-hover": 'rgb(var(--color-surface-hover) / <alpha-value>)',
                "text-main": 'rgb(var(--color-text-main) / <alpha-value>)',
                "text-muted": 'rgb(var(--color-text-muted) / <alpha-value>)',
                border: 'rgb(var(--color-border) / <alpha-value>)',
                primary: 'rgb(var(--color-primary) / <alpha-value>)',
                secondary: 'rgb(var(--color-secondary) / <alpha-value>)',
                accent: 'rgb(var(--color-accent) / <alpha-value>)',
                "accent-hover": 'rgb(var(--color-accent-hover) / <alpha-value>)',
            },
            animation: {
                progress: 'progress 1s ease-in-out infinite',
            },
            keyframes: {
                progress: {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(100%)' },
                }
            }
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
}
