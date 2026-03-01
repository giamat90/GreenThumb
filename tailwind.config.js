/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: "#2D6A4F",
        secondary: "#52B788",
        lightgreen: "#D8F3DC",
        cream: "#F8F9FA",
        danger: "#EF4444",
        warning: "#F59E0B",
        success: "#10B981",
      },
    },
  },
  plugins: [],
};
