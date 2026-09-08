import { chatCompletion } from './openai.js';
import { supabaseAdmin } from './supabase.js';

const DECISION_SYSTEM = `You are the "Applywizz Smart Hospitality AI".
Your job is to decide whether to send a personalized office service notification to an employee.

PERSONALITY MODES:
1. Professional: Formal, concise, clear.
2. Friendly (Default): Modern, energetic, Zomato-style.
3. Funny: Humorous, pun-heavy, witty.
4. Mom Mode: Caring, warm, lightly funny, playful. "Beta, water break? 😄"
5. Minimal: Just the facts, very few emojis.

MOM MODE RULES (Strict):
- Caring, not controlling. Funny, not insulting.
- No health shaming or guilt-tripping.
- Use only if employee opted in.
- Example: "Jagan, 2 days no CCD coffee? Are you okay, or in love with outside tea? 😄"

OFFICE CONTEXT:
- Hours: 9 AM - 5 PM, Mon-Fri. Lunch: 1 PM - 2 PM.
- Pantry: CCD Machine, Bread, Peanut Butter, Jam, Lemon Tea.

Return JSON ONLY.
{
  "send_notification": boolean,
  "notification_type": "Tea Coffee Reminder" | "Lunch" | "Snack" | "Hydration",
  "tone_used": "Mom Mode" | "Friendly" | "Professional" | "Funny" | "Minimal",
  "title": "Short catchy title",
  "message": "The message in the chosen TONE",
  "buttons": ["Button 1", "Button 2", "Skip"],
  "reason": "Internal reasoning"
}`;

export async function getAIDecision(employeeId) {
  try {
    // 1. Fetch Context
    const { data: prefs } = await supabaseAdmin
      .from('employee_ai_preferences')
      .select('*')
      .eq('employee_id', employeeId)
      .single();
    const { data: behavior } = await supabaseAdmin
      .from('employee_notification_behavior')
      .select('*')
      .eq('employee_id', employeeId);
    const { data: scores } = await supabaseAdmin
      .from('employee_preference_scores')
      .select('*')
      .eq('employee_id', employeeId);
    const { data: policy } = await supabaseAdmin
      .from('employee_reminder_policy')
      .select('*')
      .eq('employee_id', employeeId)
      .single();
    const { data: schedule } = await supabaseAdmin
      .from('office_schedule_settings')
      .select('*')
      .single();
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', employeeId)
      .single();

    const now = new Date();
    const currentTime = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const day = now.toLocaleDateString([], { weekday: 'long' });

    // 2. Prepare Context for GPT
    const context = {
      employee_name: profile?.full_name || 'Team Member',
      current_day: day,
      current_time: currentTime,
      preferences: prefs || {},
      scores: scores || [],
      behavior: behavior || [],
      policy: policy || {},
      schedule: schedule || {},
      available_items: ['Coffee (CCD)', 'Tea', 'Lemon Tea', 'Bread', 'Peanut Butter', 'Jam'],
    };

    // 3. Ask AI
    const { content } = await chatCompletion({
      system: DECISION_SYSTEM,
      user: JSON.stringify(context),
      model: 'gpt-4o-mini',
      temperature: 0.7,
    });

    const decision = JSON.parse(content.replace(/```json|```/g, '').trim());
    return decision;
  } catch (e) {
    console.error('AI Decision Error:', e);
    return { send_notification: false };
  }
}
