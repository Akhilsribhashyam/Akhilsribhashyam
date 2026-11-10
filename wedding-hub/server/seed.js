/* Default content seeded on first run. Everything here is editable/removable from the admin screens. */

export const DEFAULT_SETTINGS = {
  couple: 'Bhuvaneswari & Akhil',
  bride: 'V. Bhuvaneswari',
  bride_parents: 'D/o Sri. S. Varadarajan & Smt. Maheswari Varadarajan',
  groom: 'S. Akhil Sribhashyam',
  groom_parents: 'S/o Sri. Sribhashyam Srinivasa Rao & Smt. Sribhashyam Seshukumari',
  date: 'Friday, 12th February 2027',
  time_text: 'Reception 7 PM · Muhurtham 1:58 AM',
  reception_text: 'Friday, 12th February 2027 · 7:00 PM onwards',
  muhurtham_text: 'Saturday, 13th February 2027 · 1:58 AM',
  venue: 'Sri Sai Balaji Function Hall',
  venue_address: 'Near Aim Concept School, Ganesh Colony, Thotapalem, Balaji Nagar, Vizianagaram, A.P. - 535002',
  maps_url: 'https://www.google.com/maps/search/?api=1&query=Sri+Sai+Balaji+Function+Hall+Thotapalem+Vizianagaram',
  // Reception on Friday evening; the muhurtham follows that night at 1:58 AM, i.e. early Saturday 13 Feb IST.
  reception_start: '2027-02-12T19:00:00+05:30',
  event_start: '2027-02-13T01:58:00+05:30',
  event_end: '',
  reg_open: '1',      // '1' = guests may register themselves, '0' = closed
  reg_passcode: '',   // optional passcode printed on the invitation; empty = no passcode
  welcome: 'Your presence will make our celebration complete. Find the schedule, book a cab, get meal alerts and discover where to eat, all in this app.',
};

export const DEFAULT_EVENTS = [
  { title: 'Reception', starts_at: Date.parse('2027-02-12T19:00:00+05:30'),
    venue: 'Sri Sai Balaji Function Hall, Vizianagaram', details: '7:00 PM onwards' },
  { title: 'Muhurtham (Wedding)', starts_at: Date.parse('2027-02-13T01:58:00+05:30'),
    venue: 'Sri Sai Balaji Function Hall, Vizianagaram', details: 'Friday night, after midnight: 1:58 AM' },
];

/* lat/lng are approximate (area level) and flagged approx=1: use "Open in Maps" for exact directions.
   Restaurant names come from public listings; admins should verify/remove as they like. */
const VZM = { city: 'Vizianagaram', lat: 18.1067, lng: 83.3956, approx: 1 };
const VSP = { city: 'Visakhapatnam', lat: 17.7231, lng: 83.3013, approx: 1 };
const RK = { city: 'Visakhapatnam', lat: 17.7142, lng: 83.3250, approx: 1 };

export const DEFAULT_PLACES = [
  // Vizianagaram: eat
  { kind: 'eat', name: 'Sri Lakshmi Mess', category: 'Non-veg meals', address: 'Near RTC Complex Road, Lower Tank Bund', note: 'One of the oldest, most famous local messes.', ...VZM },
  { kind: 'eat', name: 'Hotel Sree Kanya', category: 'Andhra meals', address: 'Vizianagaram', note: 'Known for its Ulava Charu.', ...VZM },
  { kind: 'eat', name: 'Platform 65 – The Train Restaurant', category: 'Themed restaurant', address: 'Vizianagaram', note: 'Fun train-themed dining.', ...VZM },
  { kind: 'eat', name: 'Sri Sai Laxmi Family Restaurant', category: 'Family restaurant', address: 'Vizianagaram', note: 'Popular with families.', ...VZM },
  { kind: 'eat', name: 'Biryani Express', category: 'Biryani', address: 'Vizianagaram', note: '', ...VZM },
  { kind: 'eat', name: 'Daksha', category: 'Restaurant', address: 'Vizianagaram', note: 'Highly rated on travel sites.', ...VZM },
  { kind: 'eat', name: 'Hotel Muntaj', category: 'Restaurant', address: 'Vizianagaram', note: '', ...VZM },
  { kind: 'eat', name: 'Hotel Blue Earth', category: 'Restaurant', address: 'Vizianagaram', note: '', ...VZM },
  // Vizianagaram: see
  { kind: 'visit', name: 'Vizianagaram Fort', category: 'Heritage', address: 'Vizianagaram', note: 'Historic fort of the Vizianagaram Maharajas, in the heart of the town.', ...VZM, lat: 18.1108, lng: 83.4010 },
  { kind: 'visit', name: 'Pydithalli Ammavari Temple', category: 'Temple', address: 'Vizianagaram', note: 'The town\'s presiding goddess; the Sirimanotsavam festival is celebrated here.', ...VZM },
  { kind: 'visit', name: 'Ramatheertham', category: 'Temple', address: 'Ramatheertham, ~12 km from Vizianagaram', note: 'Ancient Rama temple on a hill, with a lovely view.', city: 'Vizianagaram', lat: 18.1860, lng: 83.4720, approx: 1 },
  // Visakhapatnam: eat
  { kind: 'eat', name: 'Jamindari Restaurant', category: 'Andhra', address: 'Near Novotel, Beach Road', note: 'Recommended by locals for traditional Andhra food.', ...RK },
  { kind: 'eat', name: 'The Square (Novotel)', category: 'Multi-cuisine', address: 'Novotel, Beach Road', note: 'Buffet and a la carte near the beach.', ...RK },
  { kind: 'eat', name: 'Red Bowl – The Pan Asian Kitchen', category: 'Pan-Asian', address: 'Near RK Beach', note: '', ...RK },
  { kind: 'eat', name: 'WelcomCafe Oceanic', category: 'Café', address: 'Near RK Beach', note: '', ...RK },
  { kind: 'eat', name: "Varun's Eat", category: 'Chaats & family dining', address: 'Varun Beach INOX', note: 'Chaat spot by the beach.', ...RK },
  { kind: 'eat', name: 'Dharani Restaurant', category: 'Andhra', address: 'Visakhapatnam', note: 'Family restaurant known for Andhra cuisine.', ...VSP },
  // Visakhapatnam: see
  { kind: 'visit', name: 'RK Beach', category: 'Beach', address: 'Beach Road', note: 'Evening walks and street food.', ...RK },
  { kind: 'visit', name: 'Kailasagiri', category: 'Hill park', address: 'Kailasagiri, Visakhapatnam', note: 'Hilltop park with sea views and a ropeway.', city: 'Visakhapatnam', lat: 17.7480, lng: 83.3420, approx: 1 },
  { kind: 'visit', name: 'Simhachalam Temple', category: 'Temple', address: 'Simhachalam', note: 'Famous Varaha Lakshmi Narasimha temple.', city: 'Visakhapatnam', lat: 17.7665, lng: 83.2506, approx: 1 },
  { kind: 'visit', name: 'Rushikonda Beach', category: 'Beach', address: 'Rushikonda', note: '', city: 'Visakhapatnam', lat: 17.7826, lng: 83.3857, approx: 1 },
  { kind: 'visit', name: 'INS Kurusura Submarine Museum', category: 'Museum', address: 'Beach Road', note: '', ...RK },
];
