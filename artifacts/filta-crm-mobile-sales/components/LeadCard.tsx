import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { FieldLeadRow } from '@workspace/api-client-react';
import { StageBadge } from './StageBadge';

export function LeadCard({ lead, onPress }: { lead: FieldLeadRow, onPress: () => void }) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.card,
        borderRadius: colors.radius,
        padding: 16,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={{ fontSize: 18, fontWeight: '600', color: colors.cardForeground, marginBottom: 4 }} numberOfLines={1}>
            {lead.companyName}
          </Text>
          <Text style={{ fontSize: 14, color: colors.mutedForeground }} numberOfLines={1}>
            {lead.city || 'Unknown City'} • {lead.territory}
          </Text>
        </View>
        <StageBadge stage={lead.stage} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
        {lead.lastActivityAt ? (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            <Feather name="clock" size={14} color={colors.mutedForeground} style={{ marginRight: 6 }} />
            <Text style={{ fontSize: 12, color: colors.mutedForeground, flex: 1 }} numberOfLines={1}>
              {new Date(lead.lastActivityAt).toLocaleDateString()} - {lead.lastActivityBody || 'Updated'}
            </Text>
          </View>
        ) : (
          <Text style={{ fontSize: 12, color: colors.mutedForeground }}>No recent activity</Text>
        )}
      </View>
    </Pressable>
  );
}
