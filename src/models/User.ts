import mongoose, { Schema, Document, Model } from "mongoose";
import bcrypt from "bcryptjs";

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  phone?: string;
  name: string;
  bio?: string;
  avatar?: string;
  status: "online" | "offline" | "away";
  lastSeen?: Date;
  isVerified: boolean;
  fcmToken?: string;
  fcmTokens: string[];
  settings: {
    lastSeenVisibility: "everyone" | "contacts" | "nobody";
    profilePhotoVisibility: "everyone" | "contacts" | "nobody";
    aboutVisibility: "everyone" | "contacts" | "nobody";
    groupsVisibility: "everyone" | "contacts" | "nobody";
    readReceipts: boolean;
    notifications: boolean;
    theme: "light" | "dark" | "system";
    keepChatsArchived: boolean;
    language: string;
  };
  blockedUsers: mongoose.Types.ObjectId[];
  contacts: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      sparse: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    bio: {
      type: String,
      default: "Hey there! I am using Streamify.",
      maxlength: 150,
    },
    avatar: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["online", "offline", "away"],
      default: "offline",
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    fcmToken: {
      type: String,
    },
    fcmTokens: [
      {
        type: String,
      },
    ],
    settings: {
      lastSeenVisibility: {
        type: String,
        enum: ["everyone", "contacts", "nobody"],
        default: "everyone",
      },
      profilePhotoVisibility: {
        type: String,
        enum: ["everyone", "contacts", "nobody"],
        default: "everyone",
      },
      aboutVisibility: {
        type: String,
        enum: ["everyone", "contacts", "nobody"],
        default: "everyone",
      },
      groupsVisibility: {
        type: String,
        enum: ["everyone", "contacts", "nobody"],
        default: "everyone",
      },
      readReceipts: {
        type: Boolean,
        default: true,
      },
      notifications: {
        type: Boolean,
        default: true,
      },
      theme: {
        type: String,
        enum: ["light", "dark", "system"],
        default: "system",
      },
      keepChatsArchived: {
        type: Boolean,
        default: false,
      },
      language: {
        type: String,
        default: "en",
      },
    },
    blockedUsers: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    contacts: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  {
    timestamps: true,
  },
);

// Index for efficient querying
userSchema.index({ name: "text", email: "text" });

// Pre-save hook for password hashing (if needed in future)
userSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password || "");
};

// Virtual for full avatar URL
userSchema.virtual("avatarUrl").get(function () {
  return (
    this.avatar ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(this.name)}&background=25D366&color=fff`
  );
});

// Transform for JSON output
userSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const User: Model<IUser> = mongoose.model<IUser>("User", userSchema);
