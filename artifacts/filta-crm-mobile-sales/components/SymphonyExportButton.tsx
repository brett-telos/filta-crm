import React, { useState } from 'react';
import { Pressable, ActivityIndicator, Alert, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { getFieldSymphonyExport } from '@workspace/api-client-react';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { GetFieldSymphonyExportStage } from '@workspace/api-client-react';

export function SymphonyExportButton() {
  const colors = useColors();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const csvData = await getFieldSymphonyExport(
        { stage: GetFieldSymphonyExportStage.scheduled },
        { responseType: 'text' }
      );
      
      const fileName = `symphony_export_${new Date().getTime()}.csv`;
      if (Platform.OS === 'web') {
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8' });
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
        return;
      }

      if (!FileSystem.documentDirectory) {
        throw new Error('No writable document directory is available');
      }
      const fileUri = `${FileSystem.documentDirectory}${fileName}`;
      
      await FileSystem.writeAsStringAsync(fileUri, csvData as string, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/csv',
          dialogTitle: 'Share Symphony Export',
        });
      } else {
        Alert.alert('Sharing not available', 'Sharing is not available on this device.');
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Export Failed', 'Unable to generate or share the export.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Pressable 
      onPress={handleExport} 
      disabled={isExporting}
      style={{ padding: 8, flexDirection: 'row', alignItems: 'center' }}
    >
      {isExporting ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Feather name="download" size={20} color={colors.primary} />
      )}
    </Pressable>
  );
}
