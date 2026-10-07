import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import Constants from 'expo-constants';

const SUPABASE_URL = 'https://dqnfviuprfzregvbnupw.supabase.co';
const API_KEY = 'sb_publishable_I4uyBIwV4c57oZbUhlTDvQ_OOTJ_pNe';

// Chauffeur de test Adelaine.
// Si son identifiant Supabase n'est pas 1, il faudra seulement changer ce nombre.
const DRIVER_ID = 1;

const API = SUPABASE_URL + '/rest/v1';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function headers(extra = {}) {
  return {
    apikey: API_KEY,
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function patchCourse(id, body) {
  const res = await fetch(`${API}/courses?id=eq.${id}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data[0];
}

async function saveDriverPosition(coords) {
  const body = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    precision_gps: coords.accuracy ?? null,
    derniere_position_at: new Date().toISOString(),
  };

  const res = await fetch(`${API}/chauffeurs?id=eq.${DRIVER_ID}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(await res.text());
}

async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('courses', {
      name: 'Nouvelles courses TAXIS ONE',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;

  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }

  if (status !== 'granted') {
    throw new Error('Autorisation de notifications refusée.');
  }

  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId;

  if (!projectId) {
    throw new Error('Projet EAS non encore lié.');
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

  const save = await fetch(`${API}/chauffeurs?id=eq.${DRIVER_ID}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ expo_push_token: token }),
  });

  if (!save.ok) throw new Error(await save.text());
  return token;
}

export default function App() {
  const [available, setAvailable] = useState(true);
  const [course, setCourse] = useState(null);
  const [syncing, setSyncing] = useState(true);
  const [pushStatus, setPushStatus] = useState('Préparation…');
  const [gpsStatus, setGpsStatus] = useState('Préparation du GPS…');
  const [lastPosition, setLastPosition] = useState(null);
  const [lastError, setLastError] = useState('');
  const lastCourseId = useRef(null);
  const locationSubscription = useRef(null);

  const loadCourse = async () => {
    try {
      const url =
        `${API}/courses?select=*&chauffeur_id=eq.${DRIVER_ID}` +
        '&statut=in.(Proposée,Acceptée,Arrivé,En cours)' +
        '&order=id.desc&limit=1';

      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(await res.text());

      const rows = await res.json();
      const next = rows[0] || null;

      if (
        next &&
        next.statut === 'Proposée' &&
        lastCourseId.current !== null &&
        lastCourseId.current !== next.id
      ) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🚕 Nouvelle course TAXIS ONE',
            body: `${next.depart} → ${next.destination}`,
            data: { courseId: next.id },
          },
          trigger: null,
        });
      }

      if (next) lastCourseId.current = next.id;
      setCourse(next);
      setLastError('');
    } catch (e) {
      setLastError(String(e?.message || e));
    } finally {
      setSyncing(false);
    }
  };

  const startGps = async () => {
    try {
      setGpsStatus('Autorisation GPS…');

      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setGpsStatus('GPS refusé par le chauffeur');
        return;
      }

      setGpsStatus('GPS actif');

      const first = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setLastPosition(first.coords);
      await saveDriverPosition(first.coords);

      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 10000,
          distanceInterval: 20,
        },
        async (location) => {
          setLastPosition(location.coords);
          try {
            await saveDriverPosition(location.coords);
            setGpsStatus('● Position transmise au Dispatch');
          } catch (e) {
            setGpsStatus('GPS actif — synchronisation à vérifier');
          }
        }
      );
    } catch (e) {
      setGpsStatus('GPS à vérifier');
      setLastError(String(e?.message || e));
    }
  };

  useEffect(() => {
    loadCourse();
    const timer = setInterval(loadCourse, 4000);

    registerForPushNotificationsAsync()
      .then(() => setPushStatus('Notifications activées'))
      .catch((e) => setPushStatus(String(e?.message || e)));

    startGps();

    return () => {
      clearInterval(timer);
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
    };
  }, []);

  const update = async (statut, extra = {}) => {
    if (!course) return;
    try {
      setSyncing(true);
      const updated = await patchCourse(course.id, { statut, ...extra });
      setCourse(updated);
      if (statut === 'Terminée' || statut === 'Refusée') {
        setTimeout(loadCourse, 600);
      }
    } catch (e) {
      Alert.alert('TAXIS ONE', 'Impossible de mettre à jour la course.');
      setLastError(String(e?.message || e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>TAXIS ONE</Text>
            <Text style={styles.subtitle}>CHAUFFEUR</Text>
          </View>
          <View style={[styles.dot, { opacity: available ? 1 : 0.35 }]} />
        </View>

        <View style={styles.hero}>
          <Text style={styles.hello}>Bonjour Adelaine ✨</Text>
          <Text style={styles.sync}>
            {syncing ? 'Synchronisation…' : '● Synchronisé'}
          </Text>
          <TouchableOpacity
            onPress={() => setAvailable((v) => !v)}
            style={[styles.availability, available && styles.availabilityOn]}
          >
            <Text style={styles.availabilityText}>
              {available ? 'Disponible' : 'Indisponible'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>📍 GPS chauffeur</Text>
          <Text style={styles.infoText}>{gpsStatus}</Text>
          {lastPosition && (
            <Text style={styles.coords}>
              {lastPosition.latitude.toFixed(5)}, {lastPosition.longitude.toFixed(5)}
            </Text>
          )}
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>🔔 Notifications</Text>
          <Text style={styles.infoText}>{pushStatus}</Text>
        </View>

        {course ? (
          <View style={styles.courseCard}>
            <Text style={styles.badge}>{course.statut}</Text>
            <Text style={styles.courseTitle}>Nouvelle mission</Text>

            <Text style={styles.label}>DÉPART</Text>
            <Text style={styles.value}>{course.depart || '—'}</Text>

            <Text style={styles.label}>DESTINATION</Text>
            <Text style={styles.value}>{course.destination || '—'}</Text>

            <View style={styles.row}>
              <View style={styles.metric}>
                <Text style={styles.label}>DISTANCE</Text>
                <Text style={styles.metricValue}>
                  {course.distance_km ? `${course.distance_km} km` : '—'}
                </Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.label}>TARIF</Text>
                <Text style={styles.metricValue}>
                  {course.tarif ? `${course.tarif} DA` : 'À définir'}
                </Text>
              </View>
            </View>

            {course.statut === 'Proposée' && (
              <View style={styles.buttons}>
                <TouchableOpacity
                  style={[styles.button, styles.reject]}
                  onPress={() => update('Refusée')}
                >
                  <Text style={styles.buttonText}>Refuser</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.accept]}
                  onPress={() =>
                    update('Acceptée', { heure_acceptation: new Date().toISOString() })
                  }
                >
                  <Text style={styles.buttonText}>Accepter</Text>
                </TouchableOpacity>
              </View>
            )}

            {course.statut === 'Acceptée' && (
              <TouchableOpacity
                style={[styles.button, styles.accept, styles.fullButton]}
                onPress={() => update('Arrivé')}
              >
                <Text style={styles.buttonText}>Je suis arrivé</Text>
              </TouchableOpacity>
            )}

            {course.statut === 'Arrivé' && (
              <TouchableOpacity
                style={[styles.button, styles.accept, styles.fullButton]}
                onPress={() =>
                  update('En cours', { heure_depart: new Date().toISOString() })
                }
              >
                <Text style={styles.buttonText}>Client à bord</Text>
              </TouchableOpacity>
            )}

            {course.statut === 'En cours' && (
              <TouchableOpacity
                style={[styles.button, styles.finish, styles.fullButton]}
                onPress={() =>
                  update('Terminée', { heure_fin: new Date().toISOString() })
                }
              >
                <Text style={styles.buttonText}>Terminer la course</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.empty}>
            {syncing ? (
              <ActivityIndicator size="large" />
            ) : (
              <>
                <Text style={styles.emptyIcon}>🚕</Text>
                <Text style={styles.emptyTitle}>En attente d'une course</Text>
                <Text style={styles.emptyText}>
                  Le Dispatch TAXIS ONE peut t'affecter une mission à tout moment.
                </Text>
              </>
            )}
          </View>
        )}

        {!!lastError && <Text style={styles.error}>{lastError}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#090713' },
  container: { padding: 20, paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 22,
  },
  brand: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', letterSpacing: 1 },
  subtitle: { color: '#A78BFA', fontSize: 11, fontWeight: '800', letterSpacing: 3 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#22D3EE' },
  hero: {
    borderRadius: 28,
    padding: 22,
    backgroundColor: '#6D28D9',
    marginBottom: 16,
  },
  hello: { color: '#FFFFFF', fontSize: 25, fontWeight: '900' },
  sync: { color: '#E9D5FF', marginTop: 6, fontWeight: '700' },
  availability: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#3F3F46',
    marginTop: 18,
  },
  availabilityOn: { backgroundColor: '#0EA5E9' },
  availabilityText: { color: '#FFFFFF', fontWeight: '900' },
  infoCard: {
    backgroundColor: '#14111F',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#29213F',
  },
  infoTitle: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
  infoText: { color: '#C4B5FD', marginTop: 5, lineHeight: 20 },
  coords: { color: '#67E8F9', marginTop: 6, fontSize: 12, fontWeight: '700' },
  courseCard: {
    backgroundColor: '#14111F',
    borderRadius: 28,
    padding: 22,
    borderWidth: 1,
    borderColor: '#3B2A59',
  },
  badge: {
    alignSelf: 'flex-start',
    color: '#22D3EE',
    fontWeight: '900',
    marginBottom: 12,
  },
  courseTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', marginBottom: 22 },
  label: { color: '#8B7FA5', fontSize: 11, fontWeight: '900', marginTop: 12 },
  value: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', marginTop: 5 },
  row: { flexDirection: 'row', gap: 12, marginTop: 14 },
  metric: { flex: 1, backgroundColor: '#20182E', borderRadius: 18, padding: 14 },
  metricValue: { color: '#FFFFFF', fontSize: 17, fontWeight: '900', marginTop: 5 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 24 },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 18,
    alignItems: 'center',
  },
  reject: { backgroundColor: '#BE123C' },
  accept: { backgroundColor: '#7C3AED' },
  finish: { backgroundColor: '#0891B2' },
  fullButton: { marginTop: 24 },
  buttonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
  empty: {
    backgroundColor: '#14111F',
    borderRadius: 28,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#29213F',
  },
  emptyIcon: { fontSize: 42 },
  emptyTitle: { color: '#FFFFFF', fontWeight: '900', fontSize: 20, marginTop: 12 },
  emptyText: { color: '#A1A1AA', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  error: { color: '#FDA4AF', marginTop: 14, fontSize: 12 },
});
