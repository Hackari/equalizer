const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx;

// DOM Elements
const waveCanvas = document.getElementById('waveform-visualizer');
const waveCtx = waveCanvas.getContext('2d');
const specCanvas = document.getElementById('spectrum-visualizer');
const specCtx = specCanvas.getContext('2d');
const reconCanvas = document.getElementById('reconstructed-visualizer');
const reconCtx = reconCanvas.getContext('2d');
const micCanvas = document.getElementById('mic-spectrogram');
const micCtx = micCanvas.getContext('2d');

const btnPlayOriginal = document.getElementById('btn-play-original');
const btnPlayRecon = document.getElementById('btn-play-recon');
const btnMic = document.getElementById('btn-start-mic');
const domFreqDisp = document.getElementById('dominant-freq');

// State
let playMode = 'none';
let oscillators = [];
let toneGains = [];
let reconStates = [true, true, true, true, true]; 
let isMicRunning = false;
let micStream, micAnalyzer;

function initAudio() {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

// --- UI SETUP ---
const defaultFrequencies = [100, 250, 440, 600, 800];
const tonesContainer = document.getElementById('tones-container');
const reconControls = document.getElementById('reconstruction-controls');

defaultFrequencies.forEach((freq, i) => {
    tonesContainer.innerHTML += `
        <div class="tone-row">
            <div class="tone-label">T${i+1}</div>
            <div class="slider-group">
                <span id="freq-display-${i}">${freq} Hz</span>
                <input type="range" id="freq-${i}" min="20" max="1000" value="${freq}">
            </div>
            <div class="slider-group">
                <span>Vol</span>
                <input type="range" id="vol-${i}" min="0" max="1" step="0.01" value="0.3">
            </div>
        </div>`;
    reconControls.innerHTML += `
        <div class="recon-item">
            <input type="checkbox" id="recon-check-${i}" checked>
            <label>Tone ${i+1}: <span id="recon-label-${i}">${freq}</span> Hz</label>
        </div>`;
});

// Listeners
for (let i = 0; i < 5; i++) {
    document.getElementById(`freq-${i}`).addEventListener('input', (e) => {
        let val = e.target.value;
        document.getElementById(`freq-display-${i}`).innerText = val + ' Hz';
        document.getElementById(`recon-label-${i}`).innerText = val; 
        if (oscillators[i]) oscillators[i].frequency.value = val;
    });
    document.getElementById(`vol-${i}`).addEventListener('input', (e) => {
        if (toneGains[i]) {
            let active = (playMode === 'original') || (playMode === 'recon' && reconStates[i]);
            toneGains[i].gain.setTargetAtTime(active ? e.target.value : 0, audioCtx.currentTime, 0.05);
        }
    });
    document.getElementById(`recon-check-${i}`).addEventListener('change', (e) => {
        reconStates[i] = e.target.checked;
        if (playMode === 'recon' && toneGains[i]) {
            let vol = document.getElementById(`vol-${i}`).value;
            toneGains[i].gain.setTargetAtTime(e.target.checked ? vol : 0, audioCtx.currentTime, 0.05);
        }
    });
}

// --- AUDIO LOGIC ---
function stopAllTones() {
    oscillators.forEach(osc => osc.stop());
    oscillators = []; toneGains = []; playMode = 'none';
    btnPlayOriginal.innerText = "Play Original"; btnPlayRecon.innerText = "Play Reconstructed";
    btnPlayOriginal.classList.remove('active'); btnPlayRecon.classList.remove('active');
}

function startTones(mode) {
    initAudio();
    if (playMode !== 'none') stopAllTones();
    playMode = mode;
    
    for (let i = 0; i < 5; i++) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = document.getElementById(`freq-${i}`).value;
        let vol = document.getElementById(`vol-${i}`).value;
        gain.gain.value = (mode === 'recon' && !reconStates[i]) ? 0 : vol;
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start();
        oscillators.push(osc); toneGains.push(gain);
    }
    const btn = mode === 'original' ? btnPlayOriginal : btnPlayRecon;
    btn.innerText = "Stop " + mode.charAt(0).toUpperCase() + mode.slice(1);
    btn.classList.add('active');
}

btnPlayOriginal.onclick = () => playMode === 'original' ? stopAllTones() : startTones('original');
btnPlayRecon.onclick = () => playMode === 'recon' ? stopAllTones() : startTones('recon');

// --- MIC LOGIC ---
async function toggleMic() {
    initAudio();
    if (isMicRunning) {
        micStream.getTracks().forEach(t => t.stop());
        isMicRunning = false;
        btnMic.innerText = "Start Microphone";
        return;
    }
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioCtx.createMediaStreamSource(micStream);
    micAnalyzer = audioCtx.createAnalyser();
    micAnalyzer.fftSize = 2048;
    source.connect(micAnalyzer);
    isMicRunning = true;
    btnMic.innerText = "Stop Microphone";
}
btnMic.onclick = toggleMic;

// --- DRAW LOOP ---
function draw() {
    requestAnimationFrame(draw);
    [waveCtx, specCtx, reconCtx].forEach(c => {
        c.fillStyle = '#121212'; c.fillRect(0,0,800,400);
    });

    let tones = [];
    for(let i=0; i<5; i++) tones.push({
        f: +document.getElementById(`freq-${i}`).value,
        v: +document.getElementById(`vol-${i}`).value,
        c: reconStates[i]
    });

    // Spectrum
    tones.forEach(t => {
        let x = (t.f / 1000) * 800;
        let y = 400 - (t.v * 340);
        specCtx.strokeStyle = t.c ? '#ff0055' : '#444';
        specCtx.lineWidth = 4;
        specCtx.beginPath(); specCtx.moveTo(x, 400); specCtx.lineTo(x, y); specCtx.stroke();
    });

    // Waveforms
    waveCtx.beginPath(); reconCtx.beginPath();
    waveCtx.strokeStyle = '#00ff64'; reconCtx.strokeStyle = '#00aaff';
    for (let x = 0; x < 800; x++) {
        let t = (x / 800) * 0.05;
        let yO = 0, yR = 0;
        tones.forEach(tone => {
            let s = tone.v * Math.sin(2 * Math.PI * tone.f * t);
            yO += s; if(tone.c) yR += s;
        });
        waveCtx.lineTo(x, 200 - yO * 40);
        reconCtx.lineTo(x, 200 - yR * 40);
    }
    waveCtx.stroke(); reconCtx.stroke();

    // Mic Spectrogram
    if (isMicRunning) {
        const data = new Uint8Array(micAnalyzer.frequencyBinCount);
        micAnalyzer.getByteFrequencyData(data);
        micCtx.fillStyle = '#0b0b0b'; micCtx.fillRect(0,0,micCanvas.width, micCanvas.height);
        let maxV = 0, maxI = 0;
        for (let i = 0; i < data.length/4; i++) {
            if(data[i] > maxV) { maxV = data[i]; maxI = i; }
            let h = (data[i]/255) * micCanvas.height;
            micCtx.fillStyle = `hsl(${200 + (data[i]/255)*100}, 100%, 50%)`;
            micCtx.fillRect(i * (micCanvas.width/(data.length/4)), micCanvas.height-h, 2, h);
        }
        domFreqDisp.innerText = maxV > 40 ? Math.round(maxI * (audioCtx.sampleRate/2048)) + " Hz" : "--- Hz";
    }
}
draw();