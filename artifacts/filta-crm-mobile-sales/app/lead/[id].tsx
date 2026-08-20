import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, RefreshControl, Linking, TextInput, Modal, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useAppInsets } from '@/hooks/useAppInsets';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { 
  useGetFieldLead, 
  usePostFieldLeadUpdate, 
  useUpsertFieldLeadContact, 
  useSetFieldLeadStage 
} from '@workspace/api-client-react';
import { StageBadge } from '@/components/StageBadge';
import { FieldStageInputStage } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import * as Haptics from 'expo-haptics';
import {
  getGetFieldLeadQueryKey,
  getGetFieldLeadsQueryKey,
  getGetFieldReportQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { SymphonyExportButton } from '@/components/SymphonyExportButton';

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useAppInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: lead, isLoading, isError, refetch, isRefetching } = useGetFieldLead(id!);

  const updateNoteMutation = usePostFieldLeadUpdate();
  const updateContactMutation = useUpsertFieldLeadContact();
  const updateStageMutation = useSetFieldLeadStage();

  const [noteText, setNoteText] = useState('');
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [contactForm, setContactForm] = useState({ fullName: '', email: '' });
  const [stageModalVisible, setStageModalVisible] = useState(false);

  const onRefresh = useCallback(() => { refetch(); }, [refetch]);

  const invalidateFieldData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetFieldLeadQueryKey(id!) }),
      queryClient.invalidateQueries({ queryKey: getGetFieldLeadsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetFieldReportQueryKey() }),
    ]);
  };

  const handleCall = () => {
    if (lead?.phoneRaw) Linking.openURL(`tel:${lead.phoneRaw}`);
  };
  
  const handleText = () => {
    if (lead?.phoneRaw) Linking.openURL(`sms:${lead.phoneRaw}`);
  };

  const handleEmail = () => {
    if (lead?.primaryContact?.email) Linking.openURL(`mailto:${lead.primaryContact.email}`);
  };

  const handleMap = () => {
    if (lead?.addressLine1 && lead?.city && lead?.state) {
      const scheme = Platform.select({ ios: 'maps:0,0?q=', android: 'geo:0,0?q=' }) || 'maps:0,0?q=';
      const q = encodeURIComponent(`${lead.addressLine1}, ${lead.city}, ${lead.state} ${lead.zip || ''}`);
      Linking.openURL(`${scheme}${q}`);
    }
  };

  const handleSaveNote = () => {
    if (!noteText.trim() || noteText.trim().length < 2) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    updateNoteMutation.mutate({ id: id!, data: { body: noteText.trim() } }, {
      onSuccess: async () => {
        setNoteText('');
        await invalidateFieldData();
      }
    });
  };

  const handleSaveContact = () => {
    if (!contactForm.fullName) return;
    updateContactMutation.mutate({ id: id!, data: contactForm }, {
      onSuccess: async () => {
        setIsEditingContact(false);
        await invalidateFieldData();
      }
    });
  };

  const handleChangeStage = (newStage: FieldStageInputStage) => {
    setStageModalVisible(false);
    updateStageMutation.mutate({ id: id!, data: { stage: newStage } }, {
      onSuccess: async () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await invalidateFieldData();
      }
    });
  };

  const openContactEditor = () => {
    setContactForm({ 
      fullName: lead?.primaryContact?.fullName || '', 
      email: lead?.primaryContact?.email || '' 
    });
    setIsEditingContact(true);
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError || !lead) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: colors.background }}>
        <Feather name="alert-triangle" size={48} color={colors.destructive} style={{ marginBottom: 16 }} />
        <Text style={{ color: colors.foreground, fontSize: 16, textAlign: 'center', marginBottom: 16 }}>Failed to load lead details.</Text>
        <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 24, paddingVertical: 12, backgroundColor: colors.secondary, borderRadius: colors.radius, marginBottom: 12 }}>
          <Text style={{ color: colors.secondaryForeground, fontWeight: '600' }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ 
        headerShown: true, 
        title: 'Lead Details',
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerRight: () => <SymphonyExportButton />
      }} />

      <KeyboardAwareScrollViewCompat
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.primary} />}
        bottomOffset={20}
      >
        <View style={{ padding: 16 }}>
          <View style={{ marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <Text style={{ fontSize: 24, fontWeight: '700', color: colors.foreground, flex: 1, marginRight: 12 }}>{lead.companyName}</Text>
              <Pressable onPress={() => setStageModalVisible(true)}>
                <StageBadge stage={lead.stage} />
              </Pressable>
            </View>
            {lead.dbaName && <Text style={{ fontSize: 16, color: colors.mutedForeground, marginBottom: 4 }}>DBA: {lead.dbaName}</Text>}
            <Text style={{ fontSize: 14, color: colors.mutedForeground }}>{lead.territory} • {lead.accountStatus}</Text>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.card, padding: 16, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border, marginBottom: 24 }}>
            <Pressable onPress={handleCall} disabled={!lead.phoneRaw} style={{ alignItems: 'center', opacity: lead.phoneRaw ? 1 : 0.4 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary + '15', justifyContent: 'center', alignItems: 'center', marginBottom: 8 }}>
                <Feather name="phone" size={24} color={colors.primary} />
              </View>
              <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: '500' }}>Call</Text>
            </Pressable>
            
            <Pressable onPress={handleText} disabled={!lead.phoneRaw} style={{ alignItems: 'center', opacity: lead.phoneRaw ? 1 : 0.4 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary + '15', justifyContent: 'center', alignItems: 'center', marginBottom: 8 }}>
                <Feather name="message-square" size={24} color={colors.primary} />
              </View>
              <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: '500' }}>Text</Text>
            </Pressable>
            
            <Pressable onPress={handleEmail} disabled={!lead.primaryContact?.email} style={{ alignItems: 'center', opacity: lead.primaryContact?.email ? 1 : 0.4 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary + '15', justifyContent: 'center', alignItems: 'center', marginBottom: 8 }}>
                <Feather name="mail" size={24} color={colors.primary} />
              </View>
              <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: '500' }}>Email</Text>
            </Pressable>

            <Pressable onPress={handleMap} disabled={!lead.addressLine1} style={{ alignItems: 'center', opacity: lead.addressLine1 ? 1 : 0.4 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary + '15', justifyContent: 'center', alignItems: 'center', marginBottom: 8 }}>
                <Feather name="map-pin" size={24} color={colors.primary} />
              </View>
              <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: '500' }}>Map</Text>
            </Pressable>
          </View>

          <View style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.foreground, marginBottom: 12 }}>Details</Text>
            <View style={{ backgroundColor: colors.card, padding: 16, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border }}>
              <View style={{ flexDirection: 'row', marginBottom: 12 }}>
                <Feather name="map" size={16} color={colors.mutedForeground} style={{ marginRight: 8, marginTop: 2 }} />
                <View>
                  <Text style={{ color: colors.foreground }}>{lead.addressLine1 || 'No address'}</Text>
                  {(lead.city || lead.state) && <Text style={{ color: colors.foreground }}>{lead.city}, {lead.state} {lead.zip}</Text>}
                </View>
              </View>
              
              <View style={{ flexDirection: 'row', marginBottom: 12, alignItems: 'center' }}>
                <Feather name="info" size={16} color={colors.mutedForeground} style={{ marginRight: 8 }} />
                <Text style={{ color: colors.foreground }}>Fryers: {lead.fryerCount ?? 'Unknown'} • Lead Source: {lead.leadSource}</Text>
              </View>

              {lead.ncaFlag && (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.stageNew + '20', padding: 8, borderRadius: 4, marginTop: 4 }}>
                  <Feather name="star" size={14} color={colors.stageNew} style={{ marginRight: 6 }} />
                  <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: '600' }}>National Account: {lead.ncaName}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={{ marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 18, fontWeight: '600', color: colors.foreground }}>Primary Contact</Text>
              <Pressable onPress={openContactEditor} style={{ padding: 4 }}>
                <Feather name="edit-2" size={16} color={colors.primary} />
              </Pressable>
            </View>

            {isEditingContact ? (
              <View style={{ backgroundColor: colors.card, padding: 16, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border }}>
                <TextInput
                  style={{ height: 40, borderBottomWidth: 1, borderColor: colors.border, color: colors.foreground, marginBottom: 12 }}
                  placeholder="Full Name"
                  placeholderTextColor={colors.mutedForeground}
                  value={contactForm.fullName}
                  onChangeText={(t) => setContactForm(prev => ({ ...prev, fullName: t }))}
                />
                <TextInput
                  style={{ height: 40, borderBottomWidth: 1, borderColor: colors.border, color: colors.foreground, marginBottom: 16 }}
                  placeholder="Email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor={colors.mutedForeground}
                  value={contactForm.email}
                  onChangeText={(t) => setContactForm(prev => ({ ...prev, email: t }))}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
                  <Pressable onPress={() => setIsEditingContact(false)} style={{ padding: 8 }}>
                    <Text style={{ color: colors.mutedForeground, fontWeight: '500' }}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={handleSaveContact} disabled={updateContactMutation.isPending} style={{ backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: colors.radius }}>
                    {updateContactMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '600' }}>Save</Text>}
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={{ backgroundColor: colors.card, padding: 16, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border }}>
                {lead.primaryContact?.fullName ? (
                  <>
                    <Text style={{ fontSize: 16, fontWeight: '500', color: colors.foreground, marginBottom: 4 }}>{lead.primaryContact.fullName}</Text>
                    {lead.primaryContact.email && <Text style={{ fontSize: 14, color: colors.mutedForeground }}>{lead.primaryContact.email}</Text>}
                  </>
                ) : (
                  <Text style={{ color: colors.mutedForeground, fontStyle: 'italic' }}>No primary contact set.</Text>
                )}
              </View>
            )}
          </View>

          <View style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.foreground, marginBottom: 12 }}>Log Visit Update</Text>
            <View style={{ backgroundColor: colors.card, padding: 16, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border }}>
              <TextInput
                style={{ 
                  minHeight: 80, 
                  textAlignVertical: 'top', 
                  color: colors.foreground, 
                  fontSize: 16,
                  marginBottom: 12
                }}
                placeholder="Use the keyboard microphone to dictate your notes..."
                placeholderTextColor={colors.mutedForeground}
                multiline
                value={noteText}
                onChangeText={setNoteText}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="mic" size={16} color={colors.mutedForeground} style={{ marginRight: 6 }} />
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Tip: Use dictation</Text>
                </View>
                <Pressable 
                  onPress={handleSaveNote} 
                  disabled={!noteText.trim() || updateNoteMutation.isPending}
                  style={{ 
                    backgroundColor: noteText.trim() ? colors.primary : colors.muted, 
                    paddingHorizontal: 16, 
                    paddingVertical: 8, 
                    borderRadius: colors.radius 
                  }}
                >
                  {updateNoteMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: noteText.trim() ? '#fff' : colors.mutedForeground, fontWeight: '600' }}>Save Note</Text>}
                </Pressable>
              </View>
            </View>
          </View>

          <View>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.foreground, marginBottom: 12 }}>Activity Feed</Text>
            {lead.feed.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontStyle: 'italic' }}>No activities recorded.</Text>
            ) : (
              <View style={{ paddingLeft: 8 }}>
                {lead.feed.map((item, idx) => (
                  <View key={item.id} style={{ flexDirection: 'row', marginBottom: 16 }}>
                    {idx !== lead.feed.length - 1 && <View style={{ width: 2, backgroundColor: colors.border, position: 'absolute', top: 20, bottom: -16, left: 5 }} />}
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary, marginTop: 4, marginRight: 12 }} />
                    <View style={{ flex: 1, backgroundColor: colors.card, padding: 12, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: colors.primary }}>{item.type.replace('_', ' ').toUpperCase()}</Text>
                        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
                          {new Date(item.occurredAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </Text>
                      </View>
                      {item.subject && <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground, marginBottom: 4 }}>{item.subject}</Text>}
                      {item.body && <Text style={{ fontSize: 14, color: colors.foreground }}>{item.body}</Text>}
                      {item.ownerName && <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 4 }}>By {item.ownerName}</Text>}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>

      <Modal visible={stageModalVisible} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setStageModalVisible(false)} />
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: insets.bottom + 24 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: colors.foreground }}>Update Stage</Text>
              <Pressable onPress={() => setStageModalVisible(false)}><Feather name="x" size={24} color={colors.foreground} /></Pressable>
            </View>
            
            {Object.values(FieldStageInputStage).map((s: string) => {
              const isActive = lead.stage === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => handleChangeStage(s as FieldStageInputStage)}
                  style={{
                    padding: 16,
                    borderRadius: colors.radius,
                    backgroundColor: isActive ? colors.primary + '15' : colors.card,
                    borderWidth: 1,
                    borderColor: isActive ? colors.primary : colors.border,
                    marginBottom: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <StageBadge stage={s} />
                  </View>
                  {isActive && <Feather name="check" size={20} color={colors.primary} />}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}
