# User guide

This is a synthetic-data demonstration. Do not enter real patient information or use demonstration AI output to make clinical decisions. Select English, తెలుగు, हिन्दी, or ଓଡ଼ିଆ on first open; the selection can be changed in Settings. Medical translations require clinician review before real-world use. Text entry remains available where voice input is unsupported.

## Patient

- **Appointments:** view upcoming and completed appointments, book a permitted slot, and review notifications.
- **Screenings:** start an oral screening from the dashboard, give data-collection and photo consent, answer symptom questions, and upload an image. Gemini processing consent is optional; without it, images are not sent to Gemini. Patient uploads with low image quality must be retaken. View only screenings linked to the account and remember that demonstration AI output is not a diagnosis.
- **Medicines:** review dose reminders and record a dose as Taken or Missed.
- **Emergency:** confirm before requesting help; location is shared only after consent. This app does not dispatch an ambulance. Call **108** for emergency assistance.
- **Language and voice:** use the AI Language Assistant for basic information and use text alternatives if speech support is unavailable.

## Health worker

- **Patients:** search or register synthetic demo patients. Registration requires data-collection consent. Offline registration is queued locally and can be synchronized when connectivity returns.
- **Screenings:** select a patient, record symptoms, and upload photographs only with photo consent. Images are encrypted before storage.
- **Follow-up:** review assigned follow-up records, medicines, referral and appointment notifications.
- **Emergency:** record an SOS on behalf of an authorized patient; never imply that an ambulance has been dispatched.

## Doctor

- **Dashboard and patients:** review authorized patients and screening history.
- **Clinical review:** evaluate screening details and image streams, record observations, and decide whether referral consideration is appropriate. Gemini image observations require the patient’s separate `AI image screening with Google Gemini` consent in the patient profile. Without that consent, images are not sent. The result is a preliminary aid only, not a diagnosis; a qualified clinician must review it. When Gemini is not configured, the separately labelled demo uses questionnaire data only, does not analyze image pixels, and shows no medical risk score. When configured, Gemini receives only consented image bytes; it is not clinically validated for oral screening, and its visual observations are preliminary.
- **Appointments and telemedicine:** book or manage an appointment with audio or video mode, then prepare its consultation from Telemedicine. The patient must have active teleconsultation consent. During a live call, patients and doctors can enable or mute their own microphone and camera; screen sharing is optional for either participant. The browser asks for camera, microphone, or screen-capture permission only when the corresponding control is used. Local development may use public `meet.jit.si`; production requires a private/non-public Jitsi domain plus app ID and JWT secret. Use HTTPS in production; browser device access is unavailable on insecure non-local origins.
- **Referrals and follow-up:** create referrals, track specialist feedback, and maintain patient follow-up.
- **Analytics:** only access the PHC-scoped analytics granted to the account.

## Specialist

- **Referral inbox:** review referred cases, update referral status, and provide specialist feedback and investigation recommendations.
- Only referred records within the account's authorization scope are visible.

## Administrator

- **Administration:** monitor synthetic registrations, screening, appointment, referral, medicine-adherence, and emergency activity; manage permitted accounts and audit records.
- **Doctor schedules:** in doctor management, edit a doctor and enter actual weekly appointment start times in 24-hour IST format, comma-separated (for example `09:00, 09:30`). Leave closed days empty. Booking only offers configured, future, unoccupied times at that doctor's assigned facility.
- **Notifications and settings:** manage preferences. Emergency notifications cannot be disabled.
- **Exports:** use only when the account has the `reports.export` permission. Export actions are audited.

## Super administrator

- In addition to administrator functions, manage system-level settings and authorized administrator accounts. Use **Create Admin Account** on the admin sign-in screen or the administrator management page; registration is available only after Super Admin sign-in. New accounts remain pending and cannot sign in until approved. Admins may sign in with their username, email, or mobile number. System settings and sensitive actions are audited.

## Sign-in and accessibility

The first Super Admin must be provisioned by the one-time setup command in the repository README. There is no public Super Admin registration. Use keyboard navigation, browser zoom, and the font-size setting. The SOS screen includes a direct 108 call option. Report suspected security incidents to the deployment operator rather than entering sensitive details into an issue tracker.
