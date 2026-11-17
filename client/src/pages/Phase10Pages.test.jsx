import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const authState = vi.hoisted(() => ({ user: null }));
const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: authState.user }) }));
vi.mock('../services/api.js', () => ({ default: apiMock }));

import LanguageSelectionPage from './LanguageSelectionPage.jsx';
import LanguageAssistantPage from './LanguageAssistantPage.jsx';
import VoiceSupportPage from './VoiceSupportPage.jsx';
import { ToastProvider } from '../components/ui/Toast.jsx';
import i18n from '../i18n/index.js';

function renderPage(page, initialEntries = ['/']) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={initialEntries}>{page}</MemoryRouter>
    </ToastProvider>,
  );
}

function setupRecorder(permissionError) {
  const tracks = [{ stop: vi.fn() }];
  const stream = { getTracks: () => tracks };
  const recorders = [];
  const getUserMedia = permissionError
    ? vi.fn().mockRejectedValue(permissionError)
    : vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  class MockMediaRecorder {
    static isTypeSupported = vi.fn(() => true);

    constructor(_stream, options) {
      this.mimeType = options?.mimeType || 'audio/webm';
      this.state = 'inactive';
      recorders.push(this);
    }

    start() {
      this.state = 'recording';
    }

    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      this.ondataavailable?.({
        data: new Blob(['synthetic audio'], { type: this.mimeType }),
      });
      this.onstop?.();
    }
  }
  window.MediaRecorder = MockMediaRecorder;
  return { getUserMedia, recorders, tracks, stream };
}

describe('Phase 10 language and voice pages', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    authState.user = null;
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
    delete window.MediaRecorder;
    delete navigator.mediaDevices;
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
    delete window.MediaRecorder;
    delete navigator.mediaDevices;
  });

  it('persists each language choice and applies all four translations', async () => {
    const choices = [
      { code: 'en', label: /English/, title: 'Choose your language' },
      { code: 'te', label: /తెలుగు/, title: 'మీ భాషను ఎంచుకోండి' },
      { code: 'hi', label: /हिन्दी/, title: 'अपनी भाषा चुनें' },
      { code: 'or', label: /ଓଡ଼ିଆ/, title: 'ଆପଣଙ୍କ ଭାଷା ବାଛନ୍ତୁ' },
    ];
    for (const choice of choices) {
      await i18n.changeLanguage('en');
      const page = renderPage(<LanguageSelectionPage />);
      fireEvent.click(screen.getByRole('button', { name: choice.label }));
      await waitFor(() => {
        expect(localStorage.getItem('aarogya-language')).toBe(choice.code);
        expect(i18n.language).toBe(choice.code);
      });
      expect(await screen.findByRole('heading', { name: choice.title })).toBeInTheDocument();
      page.unmount();
    }
  });

  it('shows the clinician-review notice and submits translation through the API', async () => {
    apiMock.post.mockResolvedValue({
      data: { data: {
        translated_text: 'Synthetic translation',
        disclaimer: 'AI-assisted translation. Medical translations must be reviewed by qualified clinicians before real-world deployment.',
        source: 'curated',
      } },
    });
    renderPage(<LanguageAssistantPage />);
    expect(screen.getByText(/Medical translations must be reviewed/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Text to translate'), {
      target: { value: 'Basic oral hygiene instructions' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    expect(await screen.findAllByText('Synthetic translation')).toHaveLength(2);
    expect(apiMock.post).toHaveBeenCalledWith('/language/translate', expect.objectContaining({
      source_lang: 'en',
      target_lang: 'te',
      mode: 'translate',
    }));
    expect(screen.getAllByText(/Medical translations must be reviewed/)).toHaveLength(2);
  });

  it('keeps a text entry alternative when audio recording is unavailable', () => {
    renderPage(<VoiceSupportPage />);
    expect(screen.getByText(/Audio recording is unavailable in this browser/))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Text to read aloud')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Start speaking' })).toBeDisabled();
  });

  it('lets users select a speech language in Voice Support', async () => {
    renderPage(<VoiceSupportPage />);
    fireEvent.change(screen.getByLabelText('Voice language'), {
      target: { value: 'te' },
    });

    await waitFor(() => {
      expect(i18n.language).toBe('te');
      expect(localStorage.getItem('aarogya-language')).toBe('te');
    });
    expect(screen.getByLabelText('వాయిస్ భాష')).toBeInTheDocument();
  });

  it('sends a voice-support question to Gemini and reads its answer aloud', async () => {
    const speech = { cancel: vi.fn(), speak: vi.fn() };
    class MockUtterance {
      constructor(value) {
        this.text = value;
      }
    }
    window.speechSynthesis = speech;
    window.SpeechSynthesisUtterance = MockUtterance;
    apiMock.post.mockResolvedValue({
      data: { data: { translated_text: 'Brush twice daily.' } },
    });

    renderPage(<VoiceSupportPage />);
    expect(screen.getByText(/This is not real-time Gemini Live streaming/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Text to read aloud'), {
      target: { value: 'How can I keep my teeth clean?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Gemini' }));

    expect(await screen.findByText('Brush twice daily.')).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith('/language/translate', {
      text: 'How can I keep my teeth clean?',
      source_lang: 'en',
      target_lang: 'en',
      mode: 'chat',
      history: [],
    });
    expect(speech.speak).toHaveBeenCalledOnce();
    expect(speech.speak.mock.calls[0][0].text).toBe('Brush twice daily.');
    expect(speech.speak.mock.calls[0][0].lang).toBe('en-IN');
  });

  it('records speech, transcribes it, and appends the transcript without losing typed text', async () => {
    const { recorders, tracks } = setupRecorder();
    apiMock.post.mockResolvedValue({
      data: { data: { transcript: 'recognized words' } },
    });
    renderPage(<VoiceSupportPage />);
    const textarea = screen.getByLabelText('Text to read aloud');
    fireEvent.change(textarea, { target: { value: 'Existing typed text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start speaking' }));
    await waitFor(() => expect(recorders).toHaveLength(1));
    expect(recorders[0].state).toBe('recording');
    expect(screen.getByText('Listening. Speak now.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop and transcribe' }));
    await waitFor(() => expect(textarea).toHaveValue('Existing typed text recognized words'));
    expect(recorders[0].state).toBe('inactive');
    expect(tracks[0].stop).toHaveBeenCalledOnce();
    expect(apiMock.post).toHaveBeenCalledWith(
      '/voice/speech-to-text',
      expect.any(FormData),
      { timeout: 45_000 },
    );
    const formData = apiMock.post.mock.calls[0][1];
    expect(formData.get('language')).toBe('en-IN');
    expect(formData.get('audio').name).toBe('voice-question.webm');
  });

  it('uses the selected regional language and prevents duplicate microphone requests', async () => {
    let resolveMicrophone;
    const { getUserMedia } = setupRecorder();
    apiMock.post.mockResolvedValue({
      data: { data: { transcript: 'నమస్కారం' } },
    });
    getUserMedia.mockImplementation(() => new Promise((resolve) => {
      resolveMicrophone = resolve;
    }));
    renderPage(<VoiceSupportPage />);
    fireEvent.change(screen.getByLabelText('Voice language'), { target: { value: 'te' } });
    await waitFor(() => expect(i18n.language).toBe('te'));
    fireEvent.click(screen.getByRole('button', { name: 'మాట్లాడటం ప్రారంభించండి' }));
    fireEvent.click(screen.getByRole('button', { name: 'మైక్రోఫోన్‌కు కనెక్ట్ అవుతోంది…' }));
    expect(getUserMedia).toHaveBeenCalledOnce();
    resolveMicrophone({ getTracks: () => [{ stop: vi.fn() }] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'ఆపి వచనంగా మార్చండి' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'ఆపి వచనంగా మార్చండి' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    expect(apiMock.post.mock.calls[0][1].get('language')).toBe('te-IN');
  });

  it('reports microphone permission errors without clearing typed text', async () => {
    setupRecorder({ name: 'NotAllowedError' });
    renderPage(<VoiceSupportPage />);
    const textarea = screen.getByLabelText('Text to read aloud');
    fireEvent.change(textarea, { target: { value: 'Keep this typed text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start speaking' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone permission was denied');
    expect(textarea).toHaveValue('Keep this typed text');
  });

  it('shows Gemini transcription errors explicitly and preserves entered text', async () => {
    const { recorders } = setupRecorder();
    apiMock.post.mockRejectedValue({
      response: { data: { code: 'GEMINI_AUTH_FAILED' } },
    });
    renderPage(<VoiceSupportPage />);
    const textarea = screen.getByLabelText('Text to read aloud');
    fireEvent.change(textarea, { target: { value: 'Keep my typed words' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start speaking' }));
    await waitFor(() => expect(recorders).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Stop and transcribe' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server Gemini API key was rejected.',
    );
    expect(textarea).toHaveValue('Keep my typed words');
  });

  it('stops the microphone and audio resources when the page unmounts', async () => {
    const { recorders, tracks } = setupRecorder();
    const page = renderPage(<VoiceSupportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Start speaking' }));
    await waitFor(() => expect(recorders).toHaveLength(1));
    page.unmount();
    expect(recorders[0].state).toBe('inactive');
    expect(tracks[0].stop).toHaveBeenCalledOnce();
  });

  it('reads the exact textarea value, stops playback, and clears text', () => {
    const speech = { cancel: vi.fn(), speak: vi.fn() };
    class MockUtterance {
      constructor(value) {
        this.text = value;
      }
    }
    window.speechSynthesis = speech;
    window.SpeechSynthesisUtterance = MockUtterance;

    renderPage(<VoiceSupportPage />);
    const exactText = '  Read this exact text.\nKeep spacing.  ';
    const textarea = screen.getByLabelText('Text to read aloud');
    fireEvent.change(textarea, { target: { value: exactText } });
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    expect(speech.speak).toHaveBeenCalledOnce();
    const utterance = speech.speak.mock.calls[0][0];
    expect(utterance.text).toBe(exactText);
    expect(utterance.lang).toBe('en-IN');

    fireEvent.click(screen.getByRole('button', { name: 'Stop audio' }));
    expect(speech.cancel).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear text' }));
    expect(textarea).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Read aloud' })).toBeDisabled();
  });

  it('explains when browser speech playback is unavailable', () => {
    renderPage(<VoiceSupportPage />);
    fireEvent.change(screen.getByLabelText('Text to read aloud'), {
      target: { value: 'Typed fallback remains available' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    expect(screen.getByText('Speech playback is unavailable. Please read the text.'))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Text to read aloud'))
      .toHaveValue('Typed fallback remains available');
  });

  it('reports speech playback errors and cancels audio on unmount', () => {
    const speech = { cancel: vi.fn(), speak: vi.fn() };
    class MockUtterance {
      constructor(value) {
        this.text = value;
      }
    }
    window.speechSynthesis = speech;
    window.SpeechSynthesisUtterance = MockUtterance;

    const page = renderPage(<VoiceSupportPage />);
    const textarea = screen.getByLabelText('Text to read aloud');
    fireEvent.change(textarea, { target: { value: 'Speak this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    act(() => speech.speak.mock.calls[0][0].onerror());
    expect(screen.getByText('Speech playback is unavailable. Please read the text.'))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Turn voice guidance on' }));
    page.unmount();
    expect(speech.cancel).toHaveBeenCalled();
  });

  it('turns voice guidance on and off and cancels active playback when disabled', () => {
    const speech = { cancel: vi.fn(), speak: vi.fn() };
    class MockUtterance {
      constructor(value) {
        this.text = value;
      }
    }
    window.speechSynthesis = speech;
    window.SpeechSynthesisUtterance = MockUtterance;

    renderPage(<VoiceSupportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn voice guidance on' }));
    expect(localStorage.getItem('aarogya-voice-guidance')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Turn voice guidance off' }));
    expect(localStorage.getItem('aarogya-voice-guidance')).toBe('false');
    expect(speech.cancel).toHaveBeenCalled();
  });

  it('lets Stop audio stop voice guidance playback on the Voice Support page', async () => {
    const speech = { cancel: vi.fn(), speak: vi.fn() };
    class MockUtterance {
      constructor(value) {
        this.text = value;
      }
    }
    window.speechSynthesis = speech;
    window.SpeechSynthesisUtterance = MockUtterance;

    renderPage(<VoiceSupportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn voice guidance on' }));
    fireEvent.focus(screen.getByLabelText('Text to read aloud'));
    await waitFor(() => expect(speech.speak).toHaveBeenCalled());

    const stopAudio = screen.getByRole('button', { name: 'Stop audio' });
    expect(stopAudio).toBeEnabled();
    fireEvent.click(stopAudio);
    expect(speech.cancel).toHaveBeenCalled();
    expect(stopAudio).toBeDisabled();
  });
});
