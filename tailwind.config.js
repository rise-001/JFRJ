/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    container: { center: true, padding: "1.5rem", screens: { "2xl": "1200px" } },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" }
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
      boxShadow: {
        soft: "0 18px 55px rgba(76, 62, 49, 0.10)",
        peach: "0 18px 38px rgba(218, 111, 103, 0.24)"
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "coin-fall": { "0%": { transform: "translateY(-12vh) rotate(0deg)", opacity: "0" }, "12%": { opacity: "1" }, "100%": { transform: "translateY(115vh) rotate(720deg)", opacity: ".9" } },
        "scan": { "0%": { transform: "translateY(0)" }, "100%": { transform: "translateY(150px)" } },
        "float": { "0%,100%": { transform: "translateY(0) rotate(8deg)" }, "50%": { transform: "translateY(-8px) rotate(4deg)" } }
      },
      animation: {
        "coin-fall": "coin-fall var(--duration, 3s) linear var(--delay, 0s) forwards",
        scan: "scan 1.5s ease-in-out infinite alternate",
        float: "float 4s ease-in-out infinite"
      }
    }
  },
  plugins: []
};
