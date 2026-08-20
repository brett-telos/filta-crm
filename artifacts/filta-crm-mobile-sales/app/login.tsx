import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import { useAppInsets } from '@/hooks/useAppInsets';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useLogin } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';

export default function LoginScreen() {
  const colors = useColors();
  const insets = useAppInsets();
  const { signIn } = useAuth();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loginMutation = useLogin();

  const handleLogin = () => {
    setErrorMsg('');
    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }
    
    loginMutation.mutate({ data: { email, password } }, {
      onSuccess: async (data) => {
        await signIn(data.token, data.user);
      },
      onError: (err) => {
        setErrorMsg(err.message || 'Login failed. Please check your credentials.');
      }
    });
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + 60,
        paddingBottom: insets.bottom + 20,
        paddingHorizontal: 24,
        justifyContent: 'center',
      }}
      bottomOffset={40}
    >
      <View style={{ alignItems: 'center', marginBottom: 48 }}>
        <Image 
          source={require('@/assets/images/icon.png')} 
          style={{ width: 88, height: 88, borderRadius: 20, marginBottom: 24 }} 
          contentFit="contain" 
        />
        <Text style={{ fontSize: 24, fontWeight: '700', color: colors.foreground, marginBottom: 8 }}>
          Field Mode
        </Text>
        <Text style={{ fontSize: 16, color: colors.mutedForeground, textAlign: 'center' }}>
          Sign in to access your pipeline and log visits.
        </Text>
      </View>

      {errorMsg ? (
        <View style={{ backgroundColor: colors.destructive + '20', padding: 12, borderRadius: colors.radius, marginBottom: 16 }}>
          <Text style={{ color: colors.destructive, fontSize: 14 }}>{errorMsg}</Text>
        </View>
      ) : null}

      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 14, fontWeight: '500', color: colors.foreground, marginBottom: 8 }}>Email</Text>
        <TextInput
          style={{
            height: 48,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: colors.radius,
            paddingHorizontal: 16,
            color: colors.foreground,
            backgroundColor: colors.card,
          }}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="rep@gofilta.com"
          placeholderTextColor={colors.mutedForeground}
          testID="email-input"
        />
      </View>

      <View style={{ marginBottom: 32 }}>
        <Text style={{ fontSize: 14, fontWeight: '500', color: colors.foreground, marginBottom: 8 }}>Password</Text>
        <TextInput
          style={{
            height: 48,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: colors.radius,
            paddingHorizontal: 16,
            color: colors.foreground,
            backgroundColor: colors.card,
          }}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={colors.mutedForeground}
          testID="password-input"
        />
      </View>

      <Pressable
        onPress={handleLogin}
        disabled={loginMutation.isPending}
        testID="login-button"
        style={({ pressed }) => ({
          backgroundColor: colors.primary,
          height: 48,
          borderRadius: colors.radius,
          justifyContent: 'center',
          alignItems: 'center',
          opacity: pressed || loginMutation.isPending ? 0.8 : 1,
        })}
      >
        {loginMutation.isPending ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={{ color: colors.primaryForeground, fontSize: 16, fontWeight: '600' }}>Sign In</Text>
        )}
      </Pressable>
    </KeyboardAwareScrollViewCompat>
  );
}
