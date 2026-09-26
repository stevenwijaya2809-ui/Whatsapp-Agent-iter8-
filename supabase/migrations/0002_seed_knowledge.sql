-- P0.2 Knowledge base: the clinic's facts move out of the prompt and into data.
-- Structured settings the code needs (hours, contact) live on the organization;
-- anything the AI quotes to a customer lives in kb_entries.

create unique index if not exists idx_kb_unique_question on kb_entries(organization_id, question);

update organizations
set settings = jsonb_build_object(
  'business', jsonb_build_object(
    'name', 'Senyum Dental Studio',
    'address', 'Jl. Sudirman No. 45, Jakarta Pusat, DKI Jakarta 10210',
    'phone', '+62 21 5550 0123',
    'email', 'halo@senyumdental.example',
    'hours', jsonb_build_object(
      'Mon', jsonb_build_array(9, 18), 'Tue', jsonb_build_array(9, 18), 'Wed', jsonb_build_array(9, 18),
      'Thu', jsonb_build_array(9, 18), 'Fri', jsonb_build_array(9, 18), 'Sat', jsonb_build_array(9, 13),
      'Sun', null
    )
  ),
  'ai', jsonb_build_object(
    'personality', 'Warm, calm and concise. Many patients are anxious about dental visits.',
    'confidenceThreshold', 0.55,
    'escalateOnComplaint', true,
    'afterHoursReply', true
  )
),
updated_at = now()
where id = '00000000-0000-0000-0000-000000000001'
  and (settings = '{}'::jsonb or settings is null);

insert into kb_entries (organization_id, category, question, answer, tags) values
  ('00000000-0000-0000-0000-000000000001', 'essentials', 'What are your opening hours?',
   'Monday to Friday 9am–6pm, Saturday 9am–1pm. Closed on Sunday. Times are Jakarta time (WIB).',
   '{hours,jam,buka,schedule}'),
  ('00000000-0000-0000-0000-000000000001', 'essentials', 'Where is the clinic located?',
   'Jl. Sudirman No. 45, Jakarta Pusat, DKI Jakarta 10210.',
   '{location,address,alamat,lokasi}'),
  ('00000000-0000-0000-0000-000000000001', 'essentials', 'How can patients contact the clinic directly?',
   'By phone on +62 21 5550 0123 or by email at halo@senyumdental.example.',
   '{contact,phone,telepon,email}'),
  ('00000000-0000-0000-0000-000000000001', 'essentials', 'What services does the clinic offer?',
   'Routine check-ups and cleanings, teeth whitening, fillings and restorations, root canals, extractions, orthodontics including Invisalign, dental implants, and emergency dental care.',
   '{services,layanan,treatments}'),
  ('00000000-0000-0000-0000-000000000001', 'booking', 'How does a patient book an appointment?',
   'Ask for the patient name, the treatment they need, and a preferred day and time, then confirm the details back to them. New patients should arrive 10–15 minutes early to complete forms.',
   '{booking,appointment,janji,reservasi}'),
  ('00000000-0000-0000-0000-000000000001', 'booking', 'How far ahead can appointments be booked?',
   'Appointments can be booked up to 8 weeks ahead, during opening hours only.',
   '{booking,availability,jadwal}'),
  ('00000000-0000-0000-0000-000000000001', 'policy', 'What is the cancellation policy?',
   'Please cancel or reschedule at least 24 hours before the appointment. Repeated no-shows may require a deposit for future bookings.',
   '{cancellation,reschedule,batal,policy}'),
  ('00000000-0000-0000-0000-000000000001', 'policy', 'What payment methods are accepted?',
   'Cash, debit and credit cards, and QRIS. Payment is taken after the treatment.',
   '{payment,pembayaran,qris,card}'),
  ('00000000-0000-0000-0000-000000000001', 'policy', 'Does the clinic accept insurance?',
   'Several major insurers are accepted. Ask the patient to bring their insurance card, and have the clinic confirm coverage before the appointment.',
   '{insurance,asuransi,bpjs,coverage}'),
  ('00000000-0000-0000-0000-000000000001', 'pricing', 'How should pricing questions be answered?',
   'Do not quote exact prices. Explain that pricing depends on the examination and invite the patient to call the clinic for a quote, or book a consultation.',
   '{price,harga,cost,biaya}'),
  ('00000000-0000-0000-0000-000000000001', 'treatment', 'How long does teeth whitening take?',
   'An in-clinic whitening session takes about 60–90 minutes. Results and suitability are confirmed at the consultation.',
   '{whitening,pemutihan,duration}'),
  ('00000000-0000-0000-0000-000000000001', 'treatment', 'How long does a routine check-up and cleaning take?',
   'About 30–45 minutes, and it is usually recommended every six months.',
   '{cleaning,checkup,scaling,duration}'),
  ('00000000-0000-0000-0000-000000000001', 'treatment', 'What should a patient do after an extraction?',
   'Bite gently on the gauze for 30 minutes, avoid rinsing, smoking and hot drinks for 24 hours, and eat soft food. Contact the clinic if bleeding or pain persists.',
   '{extraction,cabut,aftercare,recovery}'),
  ('00000000-0000-0000-0000-000000000001', 'emergency', 'What counts as a dental emergency?',
   'Severe pain, facial swelling, bleeding that will not stop, or a knocked-out tooth. Tell the patient to call the clinic immediately or visit an emergency dentist; do not wait for a scheduled appointment.',
   '{emergency,darurat,pain,swelling,urgent}'),
  ('00000000-0000-0000-0000-000000000001', 'essentials', 'Is the clinic open on Sunday?',
   'No, the clinic is closed on Sunday. Messages received then are answered on the next working day.',
   '{sunday,minggu,closed,hours}')
on conflict (organization_id, question) do nothing;
