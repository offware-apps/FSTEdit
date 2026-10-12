import { findSilences } from '../lib/silence';
import type { SilencePlugin } from './types';

/** Every stretch quieter than a threshold for long enough. */
export const loudnessSilence: SilencePlugin = {
  id: 'loudness',
  label: 'Loudness threshold',
  find: findSilences,
};
