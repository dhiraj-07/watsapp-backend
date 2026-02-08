import { config } from '../config';

// In-memory OTP store (use Redis in production)
const otpStore = new Map<string, { otp: string; expiresAt: Date; attempts: number }>();

const OTP_EXPIRY_MINUTES = 5;
const MAX_ATTEMPTS = 3;

export const generateOTP = (): string => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

export const storeOTP = (phone: string, otp: string): void => {
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    otpStore.set(phone, { otp, expiresAt, attempts: 0 });

    // Auto-cleanup after expiry
    setTimeout(() => {
        otpStore.delete(phone);
    }, OTP_EXPIRY_MINUTES * 60 * 1000);
};

export const verifyOTP = (phone: string, inputOtp: string): { valid: boolean; message: string } => {
    const stored = otpStore.get(phone);

    if (!stored) {
        return { valid: false, message: 'OTP expired or not found. Please request a new one.' };
    }

    if (new Date() > stored.expiresAt) {
        otpStore.delete(phone);
        return { valid: false, message: 'OTP has expired. Please request a new one.' };
    }

    if (stored.attempts >= MAX_ATTEMPTS) {
        otpStore.delete(phone);
        return { valid: false, message: 'Too many failed attempts. Please request a new OTP.' };
    }

    if (stored.otp !== inputOtp) {
        stored.attempts++;
        return { valid: false, message: `Invalid OTP. ${MAX_ATTEMPTS - stored.attempts} attempts remaining.` };
    }

    otpStore.delete(phone);
    return { valid: true, message: 'OTP verified successfully' };
};

export const sendOTP = async (phone: string): Promise<{ success: boolean; message: string; otp?: string }> => {
    try {
        const otp = generateOTP();
        storeOTP(phone, otp);

        // In development, return OTP directly
        if (config.nodeEnv === 'development') {
            console.log(`📱 OTP for ${phone}: ${otp}`);
            return { success: true, message: 'OTP sent successfully', otp };
        }

        // Production: Use Twilio
        if (config.twilio.accountSid && config.twilio.authToken) {
            // Twilio integration would go here
            // const twilio = require('twilio')(config.twilio.accountSid, config.twilio.authToken);
            // await twilio.messages.create({
            //   body: `Your Streamify verification code is: ${otp}`,
            //   from: config.twilio.phoneNumber,
            //   to: phone,
            // });
            return { success: true, message: 'OTP sent successfully' };
        }

        // Fallback for testing
        console.log(`📱 OTP for ${phone}: ${otp}`);
        return { success: true, message: 'OTP sent successfully (dev mode)', otp };
    } catch (error) {
        console.error('Failed to send OTP:', error);
        return { success: false, message: 'Failed to send OTP. Please try again.' };
    }
};
