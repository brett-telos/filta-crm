import React from 'react';
import { View, Text } from 'react-native';
import { useColors } from '@/hooks/useColors';

export function StageBadge({ stage }: { stage: string }) {
  const colors = useColors() as any;
  
  const getStageColor = (s: string) => {
    switch (s) {
      case 'new_lead': return colors.stageNew || '#FFC425';
      case 'contacted': return colors.stageContacted || '#6CB33F';
      case 'proposal': return colors.stageProposal || '#6CADDE';
      case 'negotiation': return colors.stageNegotiation || '#820024';
      case 'closed_won': return colors.stageWon || '#00A98F';
      case 'closed_lost': return colors.stageLost || '#4A5568';
      default: return colors.mutedForeground;
    }
  };

  const bg = getStageColor(stage);

  return (
    <View style={{ 
      backgroundColor: bg + '20',
      paddingHorizontal: 8, 
      paddingVertical: 4, 
      borderRadius: 12,
      borderWidth: 1,
      borderColor: bg + '50'
    }}>
      <Text style={{ color: bg, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' }}>
        {stage.replace('_', ' ')}
      </Text>
    </View>
  );
}
