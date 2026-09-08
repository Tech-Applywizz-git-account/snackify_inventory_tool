import { chatCompletion } from './openai.js';
import { supabaseAdmin } from './supabase.js';

const LEARNING_SYSTEM = `You are the "Applywizz Employee Preference Learning Assistant".
Your job is to update an employee’s office hospitality preference profile based on new activity.
The office provides tea, coffee, CCD coffee, lemon tea, water, snacks, bread, peanut butter, and lunch reminders.

SCORING RULES:
- Ordered item: +10
- Clicked notification: +8
- Rated 5 stars: +10
- Rated 4 stars: +6
- Skipped item: -5
- Ignored notification: -3
- Rated 1-2 stars: -10
- Complaint about item: -8
- Accepted alternative: +12

TASTE RULES:
- If comment says "too sweet", update sugar to "Less sugar".
- If "strong coffee", update strength to "Strong".
- If "no milk", update milk to "No milk".

Return JSON ONLY in the specified format.`;

export async function processDailyLearning(employeeId) {
  try {
    // 1. Fetch Today's Activity
    const today = new Date().toISOString().split('T')[0];
    const { data: requests } = await supabaseAdmin
      .from('requests')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('created_at', today);
    const { data: currentPrefs } = await supabaseAdmin
      .from('employee_ai_preferences')
      .select('*')
      .eq('employee_id', employeeId)
      .single();
    const { data: scores } = await supabaseAdmin
      .from('employee_preference_scores')
      .select('*')
      .eq('employee_id', employeeId);

    // 2. AI Analysis
    const { content } = await chatCompletion({
      system: LEARNING_SYSTEM,
      user: JSON.stringify({
        profile: currentPrefs || {},
        current_scores: scores || [],
        activity: requests || [],
      }),
      model: 'gpt-4o-mini',
    });

    const update = JSON.parse(content.replace(/```json|```/g, '').trim());

    // 3. Apply Score Updates & Taste Preferences
    for (const scoreUpdate of update.score_updates || []) {
      await supabaseAdmin.from('employee_preference_scores').upsert(
        {
          employee_id: employeeId,
          preference_type: scoreUpdate.preference_type,
          preference_value: scoreUpdate.preference_value,
          score: scoreUpdate.new_score,
          last_updated_at: new Date().toISOString(),
        },
        { onConflict: 'employee_id, preference_type, preference_value' }
      );
    }

    if (update.updated_preferences) {
      const up = update.updated_preferences;
      // Update main profile
      await supabaseAdmin.from('employee_ai_preferences').upsert(
        {
          employee_id: employeeId,
          preferred_drink: up.preferred_drink,
          secondary_drink: up.secondary_drink,
          sugar_preference: up.sugar_preference,
          notification_tone: up.notification_tone,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'employee_id' }
      );

      // Update taste specific
      if (up.sugar_preference || up.coffee_strength) {
        await supabaseAdmin.from('employee_taste_preferences').upsert(
          {
            employee_id: employeeId,
            item_name: up.preferred_drink || 'General',
            sugar_preference: up.sugar_preference,
            strength_preference: up.coffee_strength,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'employee_id, item_name' }
        );
      }
    }

    // 4. Log the Learning
    await supabaseAdmin.from('employee_daily_learning_logs').insert({
      employee_id: employeeId,
      activity_summary: `Processed ${requests.length} events today.`,
      new_profile_snapshot: update.updated_preferences,
      learning_summary: update.learning_summary,
    });

    return update;
  } catch (e) {
    console.error('Self-Learning Error:', e);
  }
}

export async function learnFromRating(employeeId, rating, comment) {
  try {
    const score = rating * 2; // Convert 1-5 rating to scoring system
    await supabaseAdmin.from('employee_preference_scores').upsert(
      {
        employee_id: employeeId,
        preference_type: 'rating',
        preference_value: 'overall',
        score: score,
        last_updated_at: new Date().toISOString(),
      },
      { onConflict: 'employee_id, preference_type, preference_value' }
    );

    if (comment) {
      const { content } = await chatCompletion({
        system: LEARNING_SYSTEM,
        user: JSON.stringify({ comment, rating }),
        model: 'gpt-4o-mini',
      });

      const tasteUpdate = JSON.parse(content.replace(/```json|```/g, '').trim());
      if (tasteUpdate.updated_preferences) {
        await supabaseAdmin.from('employee_ai_preferences').upsert(
          {
            employee_id: employeeId,
            ...tasteUpdate.updated_preferences,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'employee_id' }
        );
      }
    }

    return { success: true };
  } catch (e) {
    console.error('Learn From Rating Error:', e);
    return { success: false, error: e.message };
  }
}
