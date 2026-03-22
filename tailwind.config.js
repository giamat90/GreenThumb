/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary:    "#3E7428",
        secondary:  "#6BA83A",
        lightgreen: "#E8F5D0",
        cream:      "#F6EFDD",
        danger:     "#D32F2F",
        warning:    "#F57C00",
        success:    "#3E7428",
      },
    },
  },
  plugins: [],
};
