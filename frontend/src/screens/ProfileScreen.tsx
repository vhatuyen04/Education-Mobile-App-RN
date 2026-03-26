import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { backgroundPresets, colors } from '../theme/colors';
import { Pill } from '../components/Pill';
import { Button } from '../components/Button';
import { toast } from '../utils/toast';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import type { LeaderboardField } from '../api/auth';

type Row = {
  key: string;
  title: string;
  meta: string;
  actionLabel: string;
  onPress: () => void;
};

export function ProfileScreen() {
  const { signOut, state, updateName, changePassword } = useAuth();
  const { settings, setRankingMode, setInterestedFields, setHobbies, setBackgroundColor, resetBackgroundColor } = useSettings();

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(state.user?.name ?? '');
  const [saving, setSaving] = useState(false);

  const displayName = state.user?.name?.trim() || state.user?.email?.split('@')[0] || 'User';
  const displayEmail = state.user?.email || '';
  const avatarLetter = (displayName.trim()[0] || 'U').toUpperCase();

  const [editFieldsOpen, setEditFieldsOpen] = useState(false);
  const [editHobbiesOpen, setEditHobbiesOpen] = useState(false);
  const [editBgOpen, setEditBgOpen] = useState(false);
  const [editPwOpen, setEditPwOpen] = useState(false);

  const [hobbiesDraft, setHobbiesDraft] = useState(settings.hobbies ?? '');
  const [oldPwDraft, setOldPwDraft] = useState('');
  const [newPwDraft, setNewPwDraft] = useState('');
  const [confirmPwDraft, setConfirmPwDraft] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const fieldOptions: LeaderboardField[] = ['Sport', 'Academy', 'Entertainment'];
  const selectedFields = settings.interestedFields ?? fieldOptions;

  const currentBg = settings.backgroundColor || colors.bg;
  const currentBgName = useMemo(() => {
    const hit = backgroundPresets.find(p => p.value.toLowerCase() === String(currentBg).toLowerCase());
    return hit?.name ?? 'Custom';
  }, [currentBg]);

  const rows = useMemo<Row[]>(
    () => [
      { key: 'help', title: 'Help', meta: 'FAQ / Contact', actionLabel: 'Open', onPress: () => toast('Help (demo)') },
      {
        key: 'account',
        title: 'Account',
        meta: 'Change password',
        actionLabel: 'Open',
        onPress: () => setEditPwOpen(true),
      },
    ],
    []
  );

  function openChangePassword() {
    setOldPwDraft('');
    setNewPwDraft('');
    setConfirmPwDraft('');
    setEditPwOpen(true);
  }

  async function savePassword() {
    if (pwSaving) return;
    if (!oldPwDraft.trim()) {
      toast('Old password is required');
      return;
    }
    if (newPwDraft.length < 6) {
      toast('New password must be at least 6 characters');
      return;
    }
    if (newPwDraft !== confirmPwDraft) {
      toast('Passwords do not match');
      return;
    }

    setPwSaving(true);
    try {
      await changePassword({ oldPassword: oldPwDraft, newPassword: newPwDraft, confirmNewPassword: confirmPwDraft });
      setEditPwOpen(false);
      toast('Password updated');
    } catch (e: any) {
      toast(String(e?.message ?? 'Update failed'));
    } finally {
      setPwSaving(false);
    }
  }

  function toggleRanking() {
    void setRankingMode(!settings.rankingMode);
  }

  async function toggleField(f: LeaderboardField) {
    const next = selectedFields.includes(f) ? selectedFields.filter(x => x !== f) : [...selectedFields, f];
    await setInterestedFields(next);
  }

  function openEditHobbies() {
    setHobbiesDraft(settings.hobbies ?? '');
    setEditHobbiesOpen(true);
  }

  async function saveHobbies() {
    await setHobbies(hobbiesDraft);
    setEditHobbiesOpen(false);
    toast('Saved');
  }

  function openEditBg() {
    setEditBgOpen(true);
  }

  async function resetBg() {
    await resetBackgroundColor();
    toast('Reset');
  }

  async function handleLogout() {
    await signOut();
  }

  function startEdit() {
    setNameDraft(state.user?.name ?? '');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setNameDraft(state.user?.name ?? '');
  }

  async function saveName() {
    if (saving) return;
    setSaving(true);
    try {
      await updateName(nameDraft);
      setEditing(false);
      toast('Name updated');
    } catch (e: any) {
      toast(String(e?.message ?? 'Update failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>Profile</Text>
            <View style={styles.hSub}>
              <Pill dot>Account</Pill>
            </View>
          </View>
        </View>

        <Card>
          <View style={styles.headerRow}>
            <View style={styles.userRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{avatarLetter}</Text>
              </View>
              <View style={{ gap: 2 }}>
                {editing ? (
                  <TextInput
                    value={nameDraft}
                    onChangeText={setNameDraft}
                    placeholder="Your name"
                    placeholderTextColor={colors.muted}
                    style={styles.nameInput}
                    autoCapitalize="words"
                    editable={!saving}
                  />
                ) : (
                  <Text style={styles.userName}>{displayName}</Text>
                )}
                <Text style={styles.userEmail}>{displayEmail}</Text>

                {editing ? (
                  <View style={styles.editBtnsInline}>
                    <Button title={saving ? 'Saving…' : 'Save'} small variant="primary" onPress={saveName} />
                    <Button title="Cancel" small onPress={cancelEdit} />
                  </View>
                ) : null}
              </View>
            </View>
            {editing ? null : <Button title="Edit" small onPress={startEdit} />}
          </View>

          <View style={styles.divider} />

          <View style={{ gap: 10 }}>
            {rows.map(r => (
              <View key={r.key} style={styles.item}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{r.title}</Text>
                  <Text style={styles.meta}>{r.meta}</Text>
                </View>
                <Button title={r.actionLabel} small onPress={r.key === 'account' ? openChangePassword : r.onPress} />
              </View>
            ))}

            <View style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>Ranking mode</Text>
                <Text style={styles.meta}>{settings.rankingMode ? 'On' : 'Off'}</Text>
              </View>
              <Button title="Change" small onPress={toggleRanking} />
            </View>

            <View style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>Fields you are interested in</Text>
                <Text style={styles.meta}>{selectedFields.length ? selectedFields.join(', ') : 'None'}</Text>
              </View>
              <Button title="Edit" small onPress={() => setEditFieldsOpen(true)} />
            </View>

            <View style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>Hobbies</Text>
                <Text style={styles.meta}>{(settings.hobbies ?? '').trim() ? settings.hobbies : 'None'}</Text>
              </View>
              <Button title="Edit" small onPress={openEditHobbies} />
            </View>

            <View style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>Background color</Text>
                <Text style={styles.meta}>Current: {currentBgName}</Text>
              </View>
              <Button title="Change" small onPress={openEditBg} />
            </View>
          </View>

          <View style={styles.divider} />

          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => [styles.logout, pressed ? { opacity: 0.9 } : null]}
          >
            <Text style={styles.logoutText}>Log out</Text>
          </Pressable>
        </Card>
      </ScrollView>

      <Modal visible={editFieldsOpen} transparent animationType="fade" onRequestClose={() => setEditFieldsOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditFieldsOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Interested fields</Text>
              <Pressable onPress={() => setEditFieldsOpen(false)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>

            <View style={{ gap: 10 }}>
              {fieldOptions.map(f => (
                <Pressable
                  key={f}
                  onPress={() => {
                    void toggleField(f);
                  }}
                  style={({ pressed }) => [styles.item, pressed ? { opacity: 0.9 } : null]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{f}</Text>
                    <Text style={styles.meta}>{selectedFields.includes(f) ? 'Selected' : 'Not selected'}</Text>
                  </View>
                </Pressable>
              ))}
            </View>

            <View style={styles.divider} />
            <View style={styles.rowEnd}>
              <Button title="Done" variant="primary" onPress={() => setEditFieldsOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={editHobbiesOpen} transparent animationType="fade" onRequestClose={() => setEditHobbiesOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditHobbiesOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Edit hobbies</Text>
              <Pressable onPress={() => setEditHobbiesOpen(false)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>

            <TextInput
              value={hobbiesDraft}
              onChangeText={setHobbiesDraft}
              placeholder="Swimming, Basketball"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />

            <View style={styles.divider} />
            <View style={styles.rowEnd}>
              <Button title="Cancel" onPress={() => setEditHobbiesOpen(false)} />
              <Button title="Save" variant="primary" onPress={saveHobbies} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={editBgOpen} transparent animationType="fade" onRequestClose={() => setEditBgOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditBgOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Background color</Text>
              <Pressable onPress={() => setEditBgOpen(false)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>

            <View style={{ gap: 10 }}>
              {backgroundPresets.map(p => (
                <Pressable
                  key={p.key}
                  onPress={() => {
                    void setBackgroundColor(p.value);
                    setEditBgOpen(false);
                    toast('Saved');
                  }}
                  style={({ pressed }) => [styles.item, pressed ? { opacity: 0.9 } : null]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{p.name}</Text>
                    <Text style={styles.meta}>{p.value}</Text>
                  </View>
                  <View style={[styles.swatch, { backgroundColor: p.value }]} />
                </Pressable>
              ))}
            </View>

            <View style={styles.divider} />
            <View style={styles.rowEnd}>
              <Button title="Reset" onPress={resetBg} />
              <Button title="Close" variant="primary" onPress={() => setEditBgOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={editPwOpen} transparent animationType="fade" onRequestClose={() => setEditPwOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditPwOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Change password</Text>
              <Pressable onPress={() => setEditPwOpen(false)} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>

            <Text style={styles.meta}>Old password</Text>
            <View style={{ height: 6 }} />
            <TextInput value={oldPwDraft} onChangeText={setOldPwDraft} style={styles.input} secureTextEntry placeholder="••••••" placeholderTextColor={colors.muted} />

            <View style={{ height: 10 }} />
            <Text style={styles.meta}>New password</Text>
            <View style={{ height: 6 }} />
            <TextInput value={newPwDraft} onChangeText={setNewPwDraft} style={styles.input} secureTextEntry placeholder="At least 6 characters" placeholderTextColor={colors.muted} />

            <View style={{ height: 10 }} />
            <Text style={styles.meta}>Confirm new password</Text>
            <View style={{ height: 6 }} />
            <TextInput value={confirmPwDraft} onChangeText={setConfirmPwDraft} style={styles.input} secureTextEntry placeholder="Repeat new password" placeholderTextColor={colors.muted} />

            <View style={styles.divider} />
            <View style={styles.rowEnd}>
              <Button title="Cancel" onPress={() => setEditPwOpen(false)} />
              <Button title={pwSaving ? 'Saving…' : 'Save'} variant="primary" onPress={savePassword} />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 14,
    paddingBottom: 30,
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  hTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '900',
  },
  hSub: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(110,231,183,.14)',
    borderWidth: 1,
    borderColor: 'rgba(110,231,183,.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.text,
    fontWeight: '900',
  },
  userName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  userEmail: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  nameInput: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.text,
    fontWeight: '900',
    minWidth: 160,
  },
  editBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editBtnsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 12,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    padding: 10,
    borderRadius: 14,
  },
  name: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 16,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  close: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  rowEnd: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: colors.text,
    fontWeight: '900',
  },
  swatch: {
    width: 34,
    height: 28,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  logout: {
    alignSelf: 'stretch',
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: {
    color: '#1a0a0f',
    fontWeight: '900',
  },
});
