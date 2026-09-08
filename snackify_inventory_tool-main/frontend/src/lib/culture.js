export const OFFICE_CULTURE = {
  hours: '9 AM - 5 PM, Monday to Friday',
  lunch_break: '1 PM - 2 PM',
  age_group: '23-25 (Gen-Z / Millennials)',
  pantry_items: [
    'CCD Coffee Machine',
    'Fresh Bread',
    'Peanut Butter',
    'Mixed Fruit Jam',
    'Lemon Tea',
    'Green Tea',
    'Assam Tea',
  ],
  tone: 'Witty, Zomato-style, high energy, emoji-heavy, friendly, proactive',

  getSmartNudge: (userName, lastOrder) => {
    const hour = new Date().getHours();

    if (hour >= 13 && hour < 14) return null; // Shh, it's lunch time

    if (lastOrder === 'Coffee') {
      return `Hey ${userName}, you're a coffee machine today! ☕️ Want to switch it up with a Lemon Tea? It's the perfect 3 PM vibe. 🍋`;
    }

    if (hour === 9) {
      return `Morning ${userName}! ☀️ The CCD machine is warmed up. Fuel for those 9 AM meetings? 🚀`;
    }

    if (hour === 16) {
      return `The 4 PM slump is real. 😴 Bread + Peanut Butter + Jam = The ultimate power move. Want some? 🥜🍓`;
    }

    return `Hey ${userName}, stay hydrated! Want some water or a quick tea break? 🍵`;
  },
};
