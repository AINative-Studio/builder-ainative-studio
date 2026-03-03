export interface DesignTokens {
  name: string;
  version: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background?: string;
    foreground?: string;
    muted?: string;
    mutedForeground?: string;
    border?: string;
  };
  typography: {
    fontFamily: string;
    sizes: {
      xs: string;
      sm: string;
      base: string;
      lg: string;
      xl: string;
      '2xl'?: string;
      '3xl'?: string;
    };
    weights?: {
      normal?: string;
      medium?: string;
      semibold?: string;
      bold?: string;
    };
  };
  spacing: {
    baseUnit: string;
    scale: number[];
  };
  borderRadius?: {
    sm?: string;
    md?: string;
    lg?: string;
    xl?: string;
  };
}

export interface DesignTokenVersion {
  id: string;
  designTokenId: string;
  version: string;
  tokens: DesignTokens;
  createdAt: Date;
  createdBy: string;
}

export interface DesignTokenRecord {
  id: string;
  userId: string;
  name: string;
  isActive: boolean;
  currentVersion: string;
  tokens: DesignTokens;
  createdAt: Date;
  updatedAt: Date;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings?: ValidationError[];
}
