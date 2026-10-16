/* =====================================================================
   STARHOME CLEANERS — Booking calculator (book.html)
   - Same steps, prices and EmailJS emails as before
   - Also sends every reservation to the Starhome booking calendar
     (URL set once in starhome-config.js)
   ===================================================================== */

const stepContainer = document.getElementById('stepContainer');
const nextBtn = document.getElementById('nextBtn');
const backBtn = document.getElementById('backBtn');
const progressBar = document.getElementById('progressBar');

// Must match the time windows in the booking system (Code.gs → CONFIG.TIME_WINDOWS)
const TIME_WINDOWS = ['Morning (08:00–12:00)', 'Afternoon (12:00–16:00)'];

const FREQUENCIES = [
  { value: 1, label: 'Once' },
  { value: 0.85, label: 'Weekly (15% off)' },
  { value: 0.9, label: 'Bi-weekly (10% off)' },
  { value: 0.95, label: 'Monthly (5% off)' }
];

let stepIndex = 0;
let steps = [];

const state = {
  service: null,
  bedrooms: 0,
  bathrooms: 0,
  location: '',
  frequency: 1,
  date: '',
  timeWindow: TIME_WINDOWS[0],
  moveSize: '',
  age: '',
  specialNeeds: '',
  name: '',
  email: '',
  phone: '',
  careHours: '',
  time: '',
  careIsNight: false,
  pickupLocation: '',
  dropoffLocation: '',
  extras: {
    oven: 0,
    windows: 0,
    walls: 0,
    detergent: 0
  }
};


/* -------------------------
   SERVICE DEFINITIONS
-------------------------- */
const SERVICES = {
  standard: {
    name: 'Standard Cleaning',
    steps: ['service', 'rooms', 'location', 'frequency', 'date', 'contact', 'summary'],
    pricing: () => {
      const base = 200;
      const bedroomRate = 60;
      const bathroomRate = 80;
      const subtotal = base + state.bedrooms * bedroomRate + state.bathrooms * bathroomRate;
      return Math.round(subtotal * state.frequency);
    }
  },
  deep: {
    name: 'Deep Cleaning',
    steps: ['service', 'rooms', 'location', 'frequency', 'date', 'contact', 'summary'],
    pricing: () => {
      const base = 800;
      const bedroomRate = 120;
      const bathroomRate = 150;
      const subtotal = base + state.bedrooms * bedroomRate + state.bathrooms * bathroomRate;
      return Math.round(subtotal * state.frequency);
    }
  },
  moving: {
    name: 'Moving Services',
    steps: ['service', 'moving', 'date', 'contact', 'summary'],
    pricing: () => ({
      small: 1000,
      medium: 1500,
      large: 3000
    })[state.moveSize] || 0
  },
  care: {
    name: 'Care Giving',
    steps: ['service', 'care', 'location', 'frequency', 'date', 'contact', 'summary'],
    pricing: () => {
      const CARE_PRICES = {
        3: 300,
        4: 350,
        5: 500,
        6: 450,
        8: 500
      };
      let basePrice = CARE_PRICES[state.careHours] || 0;
      if (state.careIsNight) {
        basePrice *= 1.15; // 15% night surcharge
      }
      return Math.round(basePrice * state.frequency);
    }
  },
  gardening: {
    name: 'Gardening Services',
    steps: ['service', 'location', 'date', 'contact', 'summary'],
    pricing: () => null // priced after an on-site garden assessment
  }
};

const EXTRAS_PRICES = {
  oven: 150,
  windows: 150,
  walls: 200,
  detergent: 150
};

const EXTRAS_LABELS = {
  oven: 'Oven Cleaning',
  windows: 'Window Cleaning',
  walls: 'Wall Cleaning',
  detergent: 'Detergents Needed'
};

function extrasAllowed() {
  return ['standard', 'deep', 'moving'].includes(state.service);
}

function extrasTotal() {
  if (!extrasAllowed()) return 0;
  return Object.keys(EXTRAS_PRICES).reduce((sum, k) => sum + state.extras[k] * EXTRAS_PRICES[k], 0);
}

// One place for the total, so the screen and the emails always agree
function computeTotal() {
  const base = SERVICES[state.service].pricing();
  if (base === null) return null; // gardening
  return base + extrasTotal();
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function mapsReady() {
  return window.google && google.maps && google.maps.places;
}


/* -------------------------
   STEP RENDERERS
-------------------------- */
function renderStep() {
  const step = steps[stepIndex];

  progressBar.style.width = ((stepIndex + 1) / steps.length) * 100 + '%';
  backBtn.style.visibility = stepIndex === 0 ? 'hidden' : 'visible';
  nextBtn.disabled = false;

  // Hide Next button on the service picker and the final (summary) step
  nextBtn.style.display = (step === 'summary' || step === 'service') ? 'none' : 'inline-block';

  if (step === 'service') {
    stepContainer.innerHTML = `
      <h1>Select a Service</h1>

      <button onclick="selectService('standard')">
        <span class="title">Standard Cleaning</span>
        <span class="subtitle"><small>Regular Maintenance</small></span>
      </button>

      <button onclick="selectService('deep')">
        <span class="title">Deep Cleaning</span>
        <span class="subtitle"><small>Detailed Maintenance</small></span>
      </button>

      <button onclick="selectService('gardening')">
        <span class="title">Garden Landscaping</span>
        <span class="subtitle"><small>Detailed Outdoor Maintenance</small></span>
      </button>

      <button onclick="selectService('moving')">
        <span class="title">Moving Services</span>
        <span class="subtitle"><small>Complete Property Clean</small></span>
      </button>

      <button onclick="selectService('care')">
        <span class="title">Care Giving</span>
        <span class="subtitle"><small>Assisting People in Need</small></span>
      </button>
    `;
  }

  if (step === 'rooms') {
    stepContainer.innerHTML = `
      <h1>Bedrooms & Bathrooms</h1>
      <input type="number" placeholder="Bedrooms" min="0" value="${state.bedrooms || ''}"
        oninput="state.bedrooms = +this.value">
      <input type="number" placeholder="Bathrooms" min="0" value="${state.bathrooms || ''}"
        oninput="state.bathrooms = +this.value">
    `;
  }

  if (step === 'moving') {
    stepContainer.innerHTML = `
      <h1>Move details</h1>

      <input
        id="pickupInput"
        type="text"
        placeholder="Start typing your pick-up address..."
        value="${escapeHtml(state.pickupLocation)}"
        oninput="state.pickupLocation = this.value"
      />

      <input
        id="dropoffInput"
        type="text"
        placeholder="Start typing your drop-off address..."
        value="${escapeHtml(state.dropoffLocation)}"
        oninput="state.dropoffLocation = this.value"
      />

      <select id="moveSizeSelect" onchange="state.moveSize = this.value">
        <option value="">Select size</option>
        <option value="small" ${state.moveSize === 'small' ? 'selected' : ''}>Small</option>
        <option value="medium" ${state.moveSize === 'medium' ? 'selected' : ''}>Medium</option>
        <option value="large" ${state.moveSize === 'large' ? 'selected' : ''}>Large</option>
      </select>
    `;

    setTimeout(() => {
      if (!mapsReady()) return;
      const pickupInput = document.getElementById('pickupInput');
      const dropoffInput = document.getElementById('dropoffInput');

      if (pickupInput) {
        const pickupAutocomplete = new google.maps.places.Autocomplete(pickupInput, {
          types: ['geocode'],
          componentRestrictions: { country: 'za' }
        });
        pickupAutocomplete.addListener('place_changed', () => {
          const place = pickupAutocomplete.getPlace();
          if (!place.formatted_address) return;
          state.pickupLocation = place.formatted_address;
          state.pickupLat = place.geometry.location.lat();
          state.pickupLng = place.geometry.location.lng();
        });
      }

      if (dropoffInput) {
        const dropoffAutocomplete = new google.maps.places.Autocomplete(dropoffInput, {
          types: ['geocode'],
          componentRestrictions: { country: 'za' }
        });
        dropoffAutocomplete.addListener('place_changed', () => {
          const place = dropoffAutocomplete.getPlace();
          if (!place.formatted_address) return;
          state.dropoffLocation = place.formatted_address;
          state.dropoffLat = place.geometry.location.lat();
          state.dropoffLng = place.geometry.location.lng();
        });
      }
    }, 0);
  }

  if (step === 'care') {
    stepContainer.innerHTML = `
      <h1>Care Details</h1>

      <input type="number" placeholder="Age" value="${escapeHtml(state.age)}"
        oninput="state.age = this.value" />

      <textarea placeholder="Special Needs" oninput="state.specialNeeds = this.value">${escapeHtml(state.specialNeeds)}</textarea>

      <label for="appt">Start Time</label>
      <input type="time" id="appt" name="appt" value="${escapeHtml(state.time)}"
        oninput="state.time = this.value" />

      <label>Care Duration</label>
      <select id="careHoursSelect" onchange="state.careHours = +this.value">
        <option value="">Select hours</option>
        ${[3, 4, 5, 6, 8].map(h => `<option value="${h}" ${state.careHours === h ? 'selected' : ''}>${h} Hours</option>`).join('')}
      </select>

      <label class="checkbox">
        Night hours<input type="checkbox" ${state.careIsNight ? 'checked' : ''}
          onchange="state.careIsNight = this.checked" />
        (+15%)
      </label>
    `;
  }

  if (step === 'location') {
    stepContainer.innerHTML = `
      <h1>Service Location</h1>
      <input
        id="locationInput"
        type="text"
        placeholder="Start typing your address..."
        value="${escapeHtml(state.location)}"
        oninput="state.location = this.value"
      />
    `;

    setTimeout(() => {
      const input = document.getElementById('locationInput');
      if (!input || !mapsReady()) return;

      const autocomplete = new google.maps.places.Autocomplete(input, {
        types: ['geocode'],
        componentRestrictions: { country: 'za' } // South Africa
      });

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place.formatted_address) return;
        state.location = place.formatted_address;
        state.lat = place.geometry.location.lat();
        state.lng = place.geometry.location.lng();
      });
    }, 0);
  }

  if (step === 'frequency') {
    stepContainer.innerHTML = `
      <h1>How Often?</h1>
      <select onchange="state.frequency = +this.value">
        ${FREQUENCIES.map(f => `<option value="${f.value}" ${state.frequency === f.value ? 'selected' : ''}>${f.label}</option>`).join('')}
      </select>
    `;
  }

  if (step === 'date') {
    // Care giving has its own start time; everything else picks a morning/afternoon slot
    const timePicker = state.service === 'care' ? '' : `
      <label for="timeWindowSelect">Preferred Time</label>
      <select id="timeWindowSelect" onchange="state.timeWindow = this.value">
        ${TIME_WINDOWS.map(w => `<option value="${w}" ${state.timeWindow === w ? 'selected' : ''}>${w}</option>`).join('')}
      </select>`;
    stepContainer.innerHTML = `
      <h1>Select Date</h1>
      <input type="date" min="${tomorrowISO()}" value="${escapeHtml(state.date)}" onchange="state.date = this.value">
      ${timePicker}
    `;
  }

  if (step === 'contact') {
    stepContainer.innerHTML = `
      <h1>Contact Details</h1>

      <input type="text" placeholder="Full Name" autocomplete="name"
        value="${escapeHtml(state.name)}" oninput="state.name = this.value" />

      <input type="email" placeholder="Email Address" autocomplete="email"
        value="${escapeHtml(state.email)}" oninput="state.email = this.value" />

      <input type="tel" placeholder="Phone Number" autocomplete="tel"
        value="${escapeHtml(state.phone)}" oninput="state.phone = this.value" />
    `;
  }

  if (step === 'summary') {
    renderSummary();
  }
}

function renderSummary() {
  const total = computeTotal();
  const svc = SERVICES[state.service];
  const freq = FREQUENCIES.find(f => f.value === state.frequency);

  let extrasHTML = '';
  if (extrasAllowed()) {
    extrasHTML = '<h3>Add extras</h3>' + Object.keys(EXTRAS_PRICES).map(k => `
      <div class="cart-item">
        <span>${EXTRAS_LABELS[k]} <small>(R${EXTRAS_PRICES[k]})</small></span>
        <div class="qty">
          <button type="button" onclick="updateExtra('${k}', -1)">−</button>
          <span>${state.extras[k]}</span>
          <button type="button" onclick="updateExtra('${k}', 1)">+</button>
        </div>
      </div>`).join('');
  }

  let cartItems = '';
  if (state.service === 'standard' || state.service === 'deep') {
    cartItems = `
      <div class="cart-item">
        <span>Bedrooms</span>
        <div class="qty">
          <button type="button" onclick="updateQty('bedrooms', -1)">−</button>
          <span>${state.bedrooms}</span>
          <button type="button" onclick="updateQty('bedrooms', 1)">+</button>
        </div>
      </div>
      <div class="cart-item">
        <span>Bathrooms</span>
        <div class="qty">
          <button type="button" onclick="updateQty('bathrooms', -1)">−</button>
          <span>${state.bathrooms}</span>
          <button type="button" onclick="updateQty('bathrooms', 1)">+</button>
        </div>
      </div>`;
  }

  const details = [
    `<p><strong>Service:</strong> ${svc.name}</p>`,
    state.service === 'care' ? `<p><strong>Start Time:</strong> ${escapeHtml(state.time)}</p>` : '',
    state.service === 'care' ? `<p><strong>Care Duration:</strong> ${escapeHtml(state.careHours)} hours</p>` : '',
    state.service === 'care' && state.careIsNight ? '<p><strong>Night Care:</strong> Yes (+15%)</p>' : '',
    state.service === 'moving'
      ? `<p><strong>From:</strong> ${escapeHtml(state.pickupLocation)}</p><p><strong>To:</strong> ${escapeHtml(state.dropoffLocation)}</p><p><strong>Size:</strong> ${escapeHtml(state.moveSize)}</p>`
      : `<p><strong>Location:</strong> ${escapeHtml(state.location)}</p>`,
    `<p><strong>Date:</strong> ${escapeHtml(state.date)}${state.service !== 'care' ? ' · ' + escapeHtml(state.timeWindow) : ''}</p>`,
    state.frequency !== 1 && freq ? `<p><strong>Frequency:</strong> ${freq.label}</p>` : '',
    `<p><strong>Name:</strong> ${escapeHtml(state.name)}</p>`,
    `<p><strong>Email:</strong> ${escapeHtml(state.email)}</p>`,
    `<p><strong>Phone:</strong> ${escapeHtml(state.phone)}</p>`
  ].join('');

  stepContainer.innerHTML = `
    <h1>Review Your Booking</h1>

    <div class="summary-block">${details}</div>

    <div class="cart">
      ${cartItems}
      ${extrasHTML}
      <div class="cart-total">
        <span>Total</span>
        <strong>${total === null ? 'Quoted after an on-site assessment' : 'R' + total}</strong>
      </div>
    </div>

    <button class="pay-btn" id="reserveBtn" onclick="reserveService()">
      Reserve Service
    </button>
  `;
}


/* -------------------------
   ACTIONS
-------------------------- */
window.selectService = (service) => {
  state.service = service;
  steps = SERVICES[service].steps;
  stepIndex = 1;
  renderStep();
};

nextBtn.onclick = () => {
  const current = steps[stepIndex];
  if (!validateStep(current)) return;
  stepIndex++;
  renderStep();
};

backBtn.onclick = () => {
  stepIndex--;
  if (stepIndex === 0) steps = ['service'];
  renderStep();
};

function clearErrors() {
  document.querySelectorAll('.error').forEach(e => e.remove());
  document.querySelectorAll('.error-field').forEach(el => el.classList.remove('error-field'));
}

function showError(element, message) {
  if (!element) { alert(message); return; }
  element.classList.add('error-field');
  const error = document.createElement('div');
  error.className = 'error';
  error.textContent = message;
  element.after(error);
}

function validateStep(step) {
  clearErrors();
  let valid = true;

  if (step === 'rooms') {
    if (!state.bedrooms || state.bedrooms <= 0) {
      showError(document.querySelector('input[placeholder="Bedrooms"]'), 'Please Enter Number of Bedrooms');
      valid = false;
    }
    if (!state.bathrooms || state.bathrooms <= 0) {
      showError(document.querySelector('input[placeholder="Bathrooms"]'), 'Please Enter Number of Bathrooms');
      valid = false;
    }
  }

  if (step === 'location') {
    if (!state.location.trim()) {
      showError(document.getElementById('locationInput'), 'Location is Required');
      valid = false;
    }
  }

  if (step === 'moving') {
    if (!state.pickupLocation.trim()) {
      showError(document.getElementById('pickupInput'), 'Pick-up Location is Required');
      valid = false;
    }
    if (!state.dropoffLocation.trim()) {
      showError(document.getElementById('dropoffInput'), 'Drop-off Location is Required');
      valid = false;
    }
    if (!state.moveSize) {
      showError(document.getElementById('moveSizeSelect'), 'Please Select Move Size');
      valid = false;
    }
  }

  if (step === 'care') {
    if (!state.age || state.age <= 0) {
      showError(document.querySelector('input[placeholder="Age"]'), 'Please Enter Age');
      valid = false;
    }
    if (!state.specialNeeds.trim()) {
      showError(document.querySelector('textarea'), 'Please Describe Special Needs');
      valid = false;
    }
    if (!state.time) {
      showError(document.getElementById('appt'), 'Please Choose a Start Time');
      valid = false;
    }
    if (!state.careHours) {
      showError(document.getElementById('careHoursSelect'), 'Please Select Care Duration');
      valid = false;
    }
  }

  if (step === 'date') {
    if (!state.date) {
      showError(document.querySelector('input[type="date"]'), 'Please Select a Date');
      valid = false;
    }
  }

  if (step === 'contact') {
    if (!state.name.trim()) {
      showError(document.querySelector('input[placeholder="Full Name"]'), 'Please Enter Your Name');
      valid = false;
    }
    if (!state.email || !state.email.includes('@')) {
      showError(document.querySelector('input[type="email"]'), 'Please Enter a Valid Email Address');
      valid = false;
    }
    if (!state.phone || state.phone.replace(/\D/g, '').length < 9) {
      showError(document.querySelector('input[type="tel"]'), 'Please Enter a Valid Phone Number');
      valid = false;
    }
  }

  return valid;
}

window.updateQty = function (field, change) {
  state[field] += change;
  if (state[field] < 1) state[field] = 1;
  renderStep();
};

window.updateExtra = function (extra, change) {
  state.extras[extra] += change;
  if (state.extras[extra] < 0) state.extras[extra] = 0;
  renderStep();
};


/* -------------------------
   BOOKING CALENDAR
-------------------------- */
function genRef() {
  const d = new Date();
  return 'SHC-' + String(d.getFullYear()).slice(-2) +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') + '-' +
    Math.floor(100 + Math.random() * 900);
}

function addHours(hhmm, hours) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (isNaN(h)) return '';
  const total = Math.min(h * 60 + (m || 0) + hours * 60, 23 * 60 + 59);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

// Never throws: the reservation still goes through if the calendar can't be reached
function sendToCalendar(payload) {
  const url = window.STARHOME_APP_URL || '';
  if (url.indexOf('https://script.google.com/') !== 0) {
    console.warn('[Starhome] STARHOME_APP_URL not set in starhome-config.js');
    return Promise.resolve({ ok: false });
  }
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
    body: JSON.stringify(payload)
  })
    .then(r => r.json())
    .catch(err => { console.error('[Starhome] Calendar sync failed', err); return { ok: false }; });
}

function bookingDetailsText(extrasList) {
  const svc = SERVICES[state.service];
  const freq = FREQUENCIES.find(f => f.value === state.frequency);
  const parts = [svc.name];
  if (state.service === 'standard' || state.service === 'deep') parts.push(state.bedrooms + ' bed, ' + state.bathrooms + ' bath');
  if (state.service === 'moving') parts.push('Move size: ' + state.moveSize + ' | From: ' + state.pickupLocation + ' | To: ' + state.dropoffLocation);
  if (state.service === 'care') parts.push('Care ' + state.careHours + 'h from ' + state.time + (state.careIsNight ? ' (night +15%)' : '') +
    ' | Age: ' + state.age + ' | Needs: ' + state.specialNeeds);
  if (state.frequency !== 1 && freq) parts.push('Frequency: ' + freq.label);
  if (extrasList.length) parts.push('Extras: ' + extrasList.join('; '));
  return parts.join(' | ');
}

window.reserveService = async function () {
  const btn = document.getElementById('reserveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

  const extrasList = [];
  if (extrasAllowed()) {
    Object.keys(EXTRAS_PRICES).forEach(k => {
      if (state.extras[k] > 0) extrasList.push(EXTRAS_LABELS[k] + ' x' + state.extras[k]);
    });
  }

  const total = computeTotal();
  const bookingRef = genRef();

  const templateParams = {
    booking_ref: bookingRef,
    name: state.name,
    service: SERVICES[state.service].name,
    date: state.date,
    time: state.service === 'care' ? state.time : state.timeWindow,
    location: state.location || state.pickupLocation,
    extras: extrasList.length ? extrasList.join(', ') : 'None',
    total: total === null ? 'Quoted after on-site assessment' : total,
    email: state.email,
    phone: state.phone,
    bedrooms: state.bedrooms,
    bathrooms: state.bathrooms
  };

  // 1) Emails (as before)
  let emailOk = true;
  try {
    await Promise.all([
      emailjs.send('service_lp7z0ve', 'template_4h13jjh', templateParams), // admin
      emailjs.send('service_lp7z0ve', 'template_4t8pk4z', templateParams)  // customer
    ]);
  } catch (error) {
    console.error('EmailJS error:', error);
    emailOk = false;
  }

  // 2) Booking calendar (sends its own emails only if EmailJS failed)
  const isCare = state.service === 'care';
  const cal = await sendToCalendar({
    source: 'website',
    skipEmails: emailOk,
    ref: bookingRef,
    service: 'Cleaning',
    name: state.name,
    phone: state.phone,
    email: state.email,
    address: state.service === 'moving' ? state.pickupLocation : state.location,
    date: state.date,
    timeWindow: isCare ? '' : state.timeWindow,
    startTime: isCare ? state.time : '',
    endTime: isCare ? addHours(state.time, Number(state.careHours) || 0) : '',
    details: bookingDetailsText(extrasList),
    estimate: total === null ? 'On-site assessment' : 'R' + total
  });

  if (emailOk || (cal && cal.ok)) {
    alert(
      'Reservation successful!\n\n' +
      'Booking ref: ' + bookingRef + '\n' +
      'A confirmation email has been sent.\n' +
      'If you do not receive the email within 5 minutes, please check your Spam folder.\n\n' +
      'Payment will be made in cash after service completion.'
    );
    window.location.href = '/';
  } else {
    if (btn) { btn.disabled = false; btn.textContent = 'Reserve Service'; }
    alert('Reservation failed. Please try again or contact us directly on 065 299 2030.');
  }
};

/* INIT */
steps = ['service'];
renderStep();
