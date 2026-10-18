/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        display: ['"Outfit"', '"Plus Jakarta Sans"', "system-ui", "sans-serif"],
      },
      colors: {
        ink: { DEFAULT: "#1e1b4b", soft: "#4c4a7a", mute: "#8b89b0" },
      },
      boxShadow: {
        pop: "0 10px 30px -10px rgba(124,58,237,.35)",
        card: "0 4px 24px -6px rgba(30,27,75,.12)",
      },
      keyframes: {
        floaty: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } },
        drive: { "0%": { transform: "translateX(-120%)" }, "100%": { transform: "translateX(120vw)" } },
        pulseRing: { "0%": { transform: "scale(.6)", opacity: ".9" }, "100%": { transform: "scale(2.2)", opacity: "0" } },
      },
      animation: {
        floaty: "floaty 4s ease-in-out infinite",
        drive: "drive 9s linear infinite",
        pulseRing: "pulseRing 1.6s ease-out infinite",
      },
    },
  },
  plugins: [],
};
