import nodemailer from 'nodemailer';
import { config } from '../config';

// In-memory OTP store (use Redis in production)
const otpStore = new Map<string, { otp: string; expiresAt: Date; attempts: number }>();

const OTP_EXPIRY_MINUTES = 5;
const MAX_ATTEMPTS = 3;

// Create reusable SMTP transporter (module-level singleton)
const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined,
});

export const generateOTP = (): string => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

export const storeOTP = (email: string, otp: string): void => {
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    otpStore.set(email, { otp, expiresAt, attempts: 0 });

    // Auto-cleanup after expiry
    setTimeout(() => {
        otpStore.delete(email);
    }, OTP_EXPIRY_MINUTES * 60 * 1000);
};

export const verifyOTP = (email: string, inputOtp: string): { valid: boolean; message: string } => {
    const stored = otpStore.get(email);

    if (!stored) {
        return { valid: false, message: 'OTP expired or not found. Please request a new one.' };
    }

    if (new Date() > stored.expiresAt) {
        otpStore.delete(email);
        return { valid: false, message: 'OTP has expired. Please request a new one.' };
    }

    if (stored.attempts >= MAX_ATTEMPTS) {
        otpStore.delete(email);
        return { valid: false, message: 'Too many failed attempts. Please request a new OTP.' };
    }

    if (stored.otp !== inputOtp) {
        stored.attempts++;
        return { valid: false, message: `Invalid OTP. ${MAX_ATTEMPTS - stored.attempts} attempts remaining.` };
    }

    otpStore.delete(email);
    return { valid: true, message: 'OTP verified successfully' };
};

export const sendOTP = async (email: string): Promise<{ success: boolean; message: string; otp?: string }> => {
    try {
        const otp = generateOTP();
        storeOTP(email, otp);

        console.log(`📧 OTP for ${email}: ${otp}`);

        if (config.smtp.user) {
            await transporter.sendMail({
                from: `DineTick <rohitk290106@gmail.com>`,
                to: email,
                subject: 'Your Streamify verification code',
                html: `
                    <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 24px;">
                        <h2 style="color: #00A884;">Streamify</h2>
                        <p>Your verification code is:</p>
                        <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #333;">${otp}</p>
                        <p style="color: #888; font-size: 14px;">This code expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
                    </div>
                `,
            });
            return { success: true, message: 'OTP sent successfully' };
        }

        // Fallback when SMTP is not configured
        return { success: true, message: 'OTP sent successfully (no SMTP configured)', otp };
    } catch (error) {
        console.error('Failed to send OTP:', error);
        return { success: false, message: 'Failed to send OTP. Please try again.' };
    }
};
