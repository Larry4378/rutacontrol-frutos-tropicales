import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeLocation = registerPlugin('NativeLocation');

export const isNativeAndroidLocation = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const addNativeLocationListener = listener => NativeLocation.addListener('location', listener);

export const startNativeLocationTracking = options => NativeLocation.start(options);

export const stopNativeLocationTracking = () => NativeLocation.stop();

export const getNativeLocationStatus = () => NativeLocation.getStatus();
