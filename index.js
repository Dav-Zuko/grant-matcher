import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/search', async (req, res) => {
  const { organizationName } = req.body;

  try {
    // Step 1 - Search for the organization
    const searchResponse = await axios.post(
      'http://data.orghunter.com/v1/charitysearch',
      null,
      {
        params: {
          user_key: process.env.ORGHUNTER_API_KEY,
          searchTerm: organizationName,
          eligible: 1,
          rows: 5
        },
      }
    );

    const results = searchResponse.data?.data;

    if (!results || results.length === 0) {
       return res.render('results', {
         org: null,
         grants: [],
         error: `No organization found matching "${organizationName}". Try a different name.`,
       });
    }

    const topOrganization = results[0];
    const topOrganizationEIN = topOrganization.ein;

    console.log(`Top organization:`, topOrganization);
    console.log(`Top organization EIN:`, topOrganizationEIN);

    // Step 2 - Fetch full organization details
    const basicResponse = await axios.post(
      `https://data.orghunter.com/v1/charitybasic`,
      null,
      {
        params: {
          user_key: process.env.ORGHUNTER_API_KEY,
          ein: topOrganizationEIN
        }
      }
    );

    const orgDetails = basicResponse.data?.data;

    if (!orgDetails) {
      return res.render("results", {
        org: null,
        grants: [],
        error: `Could not recieve organization details. Please try again.`,
      });
    }

    // Step 3 - Build keyword string from organization details
    const keywords = keywordGen(orgDetails, topOrganization);
    console.log(`Keywords:`, keywords);

    const grantsResponse = await axios.post(
      `https://api.grants.gov/v1/api/search2`,
      {
        keyword: keywords,
        oppStatuses: `forcasted|posted`,
        eligibilities: `12`,
        fundingInstruments: `G`,
        sortBy: `openDate|desc`,
        rows: 5,
        startRecordNum: 0
      }
    );

    const grants = grantsResponse.data?.data?.oppHits || [];

    console.log('Found grants:', JSON.stringify(grants));

    res.render('results', { orgDetails, grants, error: null });
  } catch (error) {
    console.error('Error occurred while searching for organizations:', error);
    res.status(500).send('Internal Server Error');
  }
});

function keywordGen(org, searchResult) {
  console.log(`Mission statement:`, searchResult?.missionStatement);
  const parts = [];

  if (org.nteeClass) parts.push(org.nteeClass);
  if (org.nteeType) parts.push(org.nteeType);
  if (org.activity2) parts.push(org.activity2);

  if (searchResult?.missionStatement) {
    parts.push(searchResult.missionStatement);
  }

  return parts.join(' ') || 'nonprofit community services';
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});