import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const speechMocks = vi.hoisted(() => ({
  recognition: {
    supported: false,
    listening: false,
    loading: false,
    transcript: '',
    error: '',
    start: vi.fn(),
    stop: vi.fn(),
    setTranscript: vi.fn(),
  },
  synthesis: {
    speaking: false,
    error: '',
    speak: vi.fn(),
    stop: vi.fn(),
  },
}));
const serviceMocks = vi.hoisted(() => ({
  askCopilot: vi.fn(),
  getCopilotHealth: vi.fn(),
}));

vi.mock('../../hooks/useSpeechRecognition.js', () => ({
  default: () => speechMocks.recognition,
}));
vi.mock('../../hooks/useSpeechSynthesis.js', () => ({
  default: () => speechMocks.synthesis,
}));
vi.mock('./copilotService.js', () => serviceMocks);

import VoiceCopilot from './VoiceCopilot.jsx';

describe('Home Page voice copilot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(speechMocks.recognition, {
      supported: false,
      listening: false,
      loading: false,
      transcript: '',
      error: '',
    });
    Object.assign(speechMocks.synthesis, { speaking: false, error: '' });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    window.localStorage.setItem('aarogya-language', 'en');
    serviceMocks.getCopilotHealth.mockResolvedValue({ configured: true });
  });

  it('answers from the bundled FAQ while offline without calling the online model', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    render(<VoiceCopilot />);

    fireEvent.change(screen.getByLabelText('Your question'), {
      target: { value: 'What are the early symptoms of oral cancer?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText(/Warning changes can include/)).toBeInTheDocument();
    expect(document.querySelector('.voice-copilot__source')).toHaveTextContent(
      'Offline oral-health guide',
    );
    expect(serviceMocks.askCopilot).not.toHaveBeenCalled();
  });

  it('sends online questions to the backend in the selected language and speaks the answer', async () => {
    serviceMocks.askCopilot.mockResolvedValue({
      answer: 'A synthetic educational answer.',
      source: 'gemini',
    });
    render(<VoiceCopilot />);

    fireEvent.change(screen.getByLabelText('Your question'), {
      target: { value: 'What is oral cancer?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      expect(serviceMocks.askCopilot).toHaveBeenCalledWith({
        text: 'What is oral cancer?',
        language: 'en',
        history: [],
      });
    });
    expect(await screen.findByText('A synthetic educational answer.')).toBeInTheDocument();
    expect(speechMocks.synthesis.speak).toHaveBeenCalledWith(
      'A synthetic educational answer.',
      'en',
    );
  });
});
