import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useAppInsets } from '@/hooks/useAppInsets';
import { useGetFieldLeads } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { LeadCard } from '@/components/LeadCard';

export default function PipelineScreen() {
  const colors = useColors();
  const insets = useAppInsets();
  const router = useRouter();
  const { signOut } = useAuth();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

  React.useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search.length >= 2 ? search : '');
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const { data, isLoading, isError, refetch, isRefetching } = useGetFieldLeads(
    debouncedSearch ? { search: debouncedSearch } : undefined
  );

  const leads = data?.rows || [];

  const stages = useMemo(() => {
    const counts: Record<string, number> = {};
    leads.forEach(lead => {
      counts[lead.stage] = (counts[lead.stage] || 0) + 1;
    });
    return Object.entries(counts).map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count);
  }, [leads]);

  const filteredLeads = useMemo(() => {
    if (!selectedStage) return leads;
    return leads.filter(l => l.stage === selectedStage);
  }, [leads, selectedStage]);

  const onRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const renderHeader = () => (
    <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 16, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text style={{ fontSize: 28, fontWeight: '700', color: colors.foreground }}>Pipeline</Text>
        <Pressable onPress={signOut} style={{ padding: 8 }}>
          <Feather name="log-out" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>
      
      <View style={{ 
        flexDirection: 'row', 
        alignItems: 'center', 
        backgroundColor: colors.muted, 
        borderRadius: colors.radius,
        paddingHorizontal: 12,
        height: 40,
        marginBottom: 16
      }}>
        <Feather name="search" size={18} color={colors.mutedForeground} />
        <TextInput
          style={{ flex: 1, marginLeft: 8, color: colors.foreground, fontSize: 16 }}
          placeholder="Search companies..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} style={{ padding: 4 }}>
            <Feather name="x-circle" size={16} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {!debouncedSearch && stages.length > 0 && (
        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={[{ stage: null, count: leads.length }, ...stages]}
            keyExtractor={(item) => item.stage || 'all'}
            renderItem={({ item }) => {
              const isSelected = selectedStage === item.stage;
              return (
                <Pressable
                  onPress={() => setSelectedStage(item.stage)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 16,
                    backgroundColor: isSelected ? colors.foreground : colors.muted,
                    marginRight: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ 
                    color: isSelected ? colors.background : colors.foreground, 
                    fontWeight: '500',
                    fontSize: 14
                  }}>
                    {item.stage ? item.stage.replace('_', ' ').toUpperCase() : 'All'}
                  </Text>
                  <View style={{ 
                    backgroundColor: isSelected ? 'rgba(255,255,255,0.2)' : colors.background, 
                    borderRadius: 10, 
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    marginLeft: 6
                  }}>
                    <Text style={{ 
                      color: isSelected ? colors.background : colors.mutedForeground, 
                      fontSize: 12, 
                      fontWeight: '600' 
                    }}>
                      {item.count}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {renderHeader()}
      
      {isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Feather name="alert-triangle" size={48} color={colors.destructive} style={{ marginBottom: 16 }} />
          <Text style={{ color: colors.foreground, fontSize: 16, textAlign: 'center', marginBottom: 16 }}>
            Failed to load pipeline.
          </Text>
          <Pressable onPress={() => refetch()} style={{ paddingHorizontal: 24, paddingVertical: 12, backgroundColor: colors.primary, borderRadius: colors.radius }}>
            <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filteredLeads}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <LeadCard 
              lead={item} 
              onPress={() => router.push(`/lead/${item.id}`)} 
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', padding: 48 }}>
              <Feather name="inbox" size={48} color={colors.mutedForeground} style={{ marginBottom: 16 }} />
              <Text style={{ color: colors.mutedForeground, fontSize: 16, textAlign: 'center' }}>
                {search ? "No leads match your search." : "Your pipeline is empty."}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
