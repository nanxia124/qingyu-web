const VOICE_KEY = "agent-tts-voice";
const RATE_KEY = "agent-tts-rate";
const AUTO_KEY = "agent-tts-auto";

export function getTtsVoice(): string {
    try { return localStorage.getItem(VOICE_KEY) || ""; } catch { return ""; }
}
export function setTtsVoice(voiceURI: string): void {
    try { voiceURI ? localStorage.setItem(VOICE_KEY, voiceURI) : localStorage.removeItem(VOICE_KEY); } catch { }
}
export function getTtsRate(): number {
    try { return Number(localStorage.getItem(RATE_KEY)) || 1; } catch { return 1; }
}
export function setTtsRate(rate: number): void {
    try { localStorage.setItem(RATE_KEY, String(rate)); } catch { }
}
export function getTtsAuto(): boolean {
    try { return localStorage.getItem(AUTO_KEY) === "1"; } catch { return false; }
}
export function setTtsAuto(auto: boolean): void {
    try { auto ? localStorage.setItem(AUTO_KEY, "1") : localStorage.removeItem(AUTO_KEY); } catch { }
}

export function speakText(text: string): void {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voiceURI = getTtsVoice();
    if (voiceURI) {
        const voice = window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI);
        if (voice) utterance.voice = voice;
    }
    utterance.rate = getTtsRate();
    window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
}

export function getAvailableVoices(): SpeechSynthesisVoice[] {
    if (!("speechSynthesis" in window)) return [];
    return window.speechSynthesis.getVoices();
}
