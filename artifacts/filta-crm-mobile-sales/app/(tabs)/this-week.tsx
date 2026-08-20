import React, { useCallback } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useAppInsets } from '@/hooks/useAppInsets';
import { useGetFieldReport } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { StageBadge } from '@/components/StageBadge';

export default function ThisWeekScreen() {
  const colors = useColors();
  const insets = useAppInsets();
  
  const { data, isLoading, isError, refetch, isRefetching } = useGetFieldReport();

  const onRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: colors.background }}>
        <Feather name="alert-triangle" size={48} color={colors.destructive} style={{ marginBottom: 16 }} />
        <Text style={{ color: colors.foreground, fontSize: 16, textAlign: 'center', marginBottom: 16 }}>
          Failed to load report.
        </Text>
        <Pressable onPress={() => refetch()} style={{ paddingHorizontal: 24, paddingVertical: 12, backgroundColor: colors.primary, borderRadius: colors.radius }}>
          <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView 
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100, paddingHorizontal: 16 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={{ fontSize: 28, fontWeight: '700', color: colors.foreground, marginBottom: 8 }}>This Week</Text>
      <Text style={{ fontSize: 14, color: colors.mutedForeground, marginBottom: 24 }}>
        {new Date(data.weekStartIso).toLocaleDateString()} – {new Date(data.weekEndIso).toLocaleDateString()}
      </Text>

      <View style={{ marginBottom: 32 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', color: colors.foreground, marginBottom: 12 }}>Open Pipeline</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {data.pipeline.map(p => (
            <View key={p.stage} style={{ backgroundColor: colors.card, padding: 12, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border, minWidth: '48%', flex: 1 }}>
              <StageBadge stage={p.stage} />
              <Text style={{ fontSize: 24, fontWeight: '700', color: colors.foreground, marginTop: 8 }}>{p.count}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ marginBottom: 32 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', color: colors.foreground, marginBottom: 12 }}>Leaderboard</Text>
        {data.reps.map((rep, idx) => (
          <View key={rep.name} style={{ backgroundColor: colors.card, padding: 16, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border, marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary + '20', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 14 }}>{idx + 1}</Text>
              </View>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.foreground, flex: 1 }}>{rep.name}</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.accent }}>{rep.won} Won</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 2 }}>Updates</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>{rep.updates}</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 2 }}>Contacted</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>{rep.contacted}</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 2 }}>Quoted</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>{rep.quoted}</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 2 }}>Scheduled</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>{rep.scheduled}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>

      <View>
        <Text style={{ fontSize: 18, fontWeight: '600', color: colors.foreground, marginBottom: 12 }}>Team Activity</Text>
        {data.changelog.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontStyle: 'italic' }}>No activity yet this week.</Text>
        ) : (
          <View style={{ paddingLeft: 8 }}>
            {data.changelog.map((log, idx) => (
              <View key={idx} style={{ flexDirection: 'row', marginBottom: 16 }}>
                {idx !== data.changelog.length - 1 && <View style={{ width: 2, backgroundColor: colors.border, position: 'absolute', top: 20, bottom: -16, left: 5 }} />}
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary, marginTop: 4, marginRight: 12 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: colors.foreground, marginBottom: 2 }}>
                    <Text style={{ fontWeight: '600' }}>{log.ownerName}</Text> at <Text style={{ fontWeight: '600' }}>{log.companyName}</Text>
                  </Text>
                  <Text style={{ fontSize: 14, color: colors.foreground, marginBottom: 4 }}>{log.body}</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
                    {new Date(log.occurredAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
